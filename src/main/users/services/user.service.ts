/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/auth.service.ts
import {
  SQL,
  and,
  asc,
  between,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection'; // your drizzle database instance
import redisClient from '../../../configurations/redisConfig';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import * as crypto from 'crypto';
import {
  emailVerifyHtml,
  generateResetPasswordEmail,
  passwordSetupEmailTemplate,
} from '../../../htmltamplates/email.tamplate';
import { welcomeSetPasswordTemplate } from '../../../htmltamplates/welcome-set-password';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import {
  CacheKeys,
  invalidateCacheByPattern,
  invalidateCacheMany,
} from '../../../utils/cache.util';
import {
  doctorScopeFilter,
  scopeCacheKey,
} from '../../permissions/utils/staffScope.utils';
import {
  comparePassword,
  generateOTP,
  generateTokenString,
  hashPassword,
  hashToken,
  signMfaTempToken,
} from '../../../utils/authUtils';
import { TokenService } from './token.service';
import { sendEmail } from '../../../utils/email';
import {
  verifyAppleIdToken,
  verifyGoogleIdToken,
  VerifiedSocialProfile,
} from '../../../utils/socialAuth';
import { pagination } from '../../../utils/utils';
import { realtimeBus, target } from '../../realtime';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import {
  ClinicAssignModel,
  ClinicModel,
  ClinicServiceModel,
} from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { DoctorQualificationModel } from '../../doctor/models/doctor.model';
import { PatientFamilyLinksModel } from '../../patient/models/patientFamilyLinks.model';
import { SettingModel } from '../../settings/models/setting.model';
import { TokenModel } from '../models/token.model';
import { UserModel } from '../models/user.model';
import { UserProfileModel } from '../models/userProfile.model';
import { UserProfessionalModel } from '../models/userProfessional.model';
import { AppointmentNoShowActionModel } from '../../appointments/models/appointmentNoShow.model';
import { ClinicSubscriptionModel } from '../../subscription/models/subscription.model';
import {
  LimitationService,
  STAFF_USER_TYPES,
  StaffUserType,
} from '../../subscription/services/limitation.service';
import { SubscriptionService } from '../../subscription/services/subscription.service';
import { PermissionService } from '../../permissions/services/permission.service';
import {
  addUserDto,
  CreatePetientDto,
  getAllPetientsDto,
  GetAllReferralsDto,
  RegisterDto,
  SearchPatientDto,
  SocialLoginDto,
  updateAdminPermissionToDoctorDto,
  UpdatePetientDto,
  UpdateUserInput,
} from '../schemas/auth.schemas';
import { registrationOtpTemplate } from '../../../htmltamplates/registerAdminWithOtp';
import { loginAlertQueue } from '../../notifications/services/loginAlertQueue.service';
import {
  PharmacyAssignModel,
  PharmacyModel,
} from '../../pharmacy/models/pharmacy.model';
import { UserLabAssignmentsModel } from '../../lab/models/lab.model';
import { doctorStatusChangeTemplate } from '../../../htmltamplates/DoctorStatusChange';
import { ReferralModel } from '../models/referral.model';
import { ReportsModel } from '../../reports/models/reports.model';
import { MfaService } from '../../mfa/services/mfa.service';

const TOKEN_TTL_MS = 8 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
// Invite ("set your password") links are short-lived; `resendInvite` issues a
// fresh one when this lapses before the invitee accepts.
const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export class UserService {
  private static assertCanLogin(userStatus: string) {
    if (userStatus === 'Inactive')
      throw new HttpError(
        403,
        'Your account has been deactivated. Please contact your clinic administrator.'
      );

    if (userStatus === 'Blocked')
      throw new HttpError(
        403,
        'Your account has been blocked. Please contact support.'
      );

    if (userStatus === 'Reviewing')
      throw new HttpError(
        401,
        'Your access is currently not authorized. Your profile status is under reviewing.'
      );

    if (userStatus === 'Rejected')
      throw new HttpError(
        401,
        'Your access is currently not authorized. Your profile status is rejected.'
      );
  }

  static async requestRegistrationVerification(email: string) {
    const existing = await database
      .select({
        id: UserModel.id,
      })
      .from(UserModel)
      .where(eq(UserModel.email, email))
      .limit(1);

    if (existing.length) {
      throw new HttpError(400, 'Email already in use');
    }

    const otp = generateOTP(6);
    const tokenHash = hashToken(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes for OTP

    await database
      .insert(TokenModel)
      .values({
        email,
        tokenHash,
        type: 'registration_verification',
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [TokenModel.email, TokenModel.tokenHash, TokenModel.type],
        set: {
          tokenHash,
          expiresAt,
          used: false,
          updatedAt: new Date(),
        },
      });

    const signUpLink = `${process.env.FRONTEND_URL || 'https://infinitymedisetu.com'}/signup?tk=${tokenHash}&email=${encodeURIComponent(email)}`;

    sendEmail(
      email,
      'Infinity Medisetu Onboarding',
      registrationOtpTemplate({ signUpLink })
    ).catch((err) => {
      logger.error(`Failed to send registration OTP email to ${email}:`, err);
    });

    return { message: 'OTP sent to your email' };
  }

  static async verifyRegistrationOTP(email: string, otp: string) {
    const tokenHash = hashToken(otp);
    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.email, email),
          eq(TokenModel.tokenHash, tokenHash),
          eq(TokenModel.type, 'registration_verification'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    if (!tok) throw new HttpError(400, 'Invalid or expired OTP');
    if (new Date(tok.expiresAt) < new Date())
      throw new HttpError(400, 'OTP expired');

    // Mark OTP as used
    await database
      // .update(TokenModel)
      // .set({ used: true })
      .delete(TokenModel)
      .where(eq(TokenModel.id, tok.id));

    // Create a registration session token
    const sessionToken = generateTokenString();
    const sessionHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour for registration

    await database.insert(TokenModel).values({
      email,
      tokenHash: sessionHash,
      type: 'registration_session',
      expiresAt: sessionExpiresAt,
    });

    return {
      message: 'OTP verified successfully',
      token: sessionToken,
    };
  }

  static async checkRegistrationToken(token: string, email?: string) {
    if (email) {
      const [existingUser] = await database
        .select({
          id: UserModel.id,
          userStatus: UserModel.userStatus,
        })
        .from(UserModel)
        .where(eq(UserModel.email, email))
        .limit(1);

      if (existingUser && existingUser.userStatus !== 'Rejected') {
        throw new HttpError(409, 'User is already registered', {
          code: 'ALREADY_REGISTERED',
          userStatus: existingUser.userStatus,
        });
      }
    }

    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.tokenHash, token),
          eq(TokenModel.type, 'registration_verification'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    if (!tok) {
      throw new HttpError(400, 'Invalid or expired registration link');
    }

    if (new Date(tok.expiresAt) < new Date()) {
      throw new HttpError(400, 'Registration link has expired');
    }

    return {
      message: 'Token is valid',
      email: tok.email,
    };
  }

  static async checkInviteToken(
    token: string,
    email?: string,
    userId?: string
  ) {
    const tokenHash = hashToken(token);

    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.tokenHash, tokenHash),
          eq(TokenModel.type, 'set_initial_password'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    // If token exists but is expired
    if (tok && new Date(tok.expiresAt) < new Date()) {
      const uId = userId || tok.userId;
      const uEmail = email || tok.email;

      if (uId || uEmail) {
        const conditions = [];
        if (uId) conditions.push(eq(UserModel.id, uId));
        if (uEmail) conditions.push(eq(UserModel.email, uEmail));

        const [existingUser] = await database
          .select({
            id: UserModel.id,
            password: UserModel.password,
            userStatus: UserModel.userStatus,
          })
          .from(UserModel)
          .where(or(...conditions))
          .limit(1);

        if (existingUser && existingUser.password) {
          throw new HttpError(409, 'User is already registered', {
            code: 'ALREADY_REGISTERED',
            userStatus: existingUser.userStatus,
          });
        }
      }
      throw new HttpError(400, 'Invitation link has expired');
    }

    // If token does not exist at all
    if (!tok) {
      if (userId || email) {
        const conditions = [];
        if (userId) conditions.push(eq(UserModel.id, userId));
        if (email) conditions.push(eq(UserModel.email, email));

        const [existingUser] = await database
          .select({
            id: UserModel.id,
            password: UserModel.password,
            userStatus: UserModel.userStatus,
          })
          .from(UserModel)
          .where(or(...conditions))
          .limit(1);

        if (existingUser && existingUser.password) {
          throw new HttpError(409, 'User is already registered', {
            code: 'ALREADY_REGISTERED',
            userStatus: existingUser.userStatus,
          });
        }
      }
      throw new HttpError(400, 'Invalid or expired invitation link');
    }

    return {
      message: 'Token is valid',
      userId: tok.userId,
      email: tok.email,
    };
  }

  static async register(payload: RegisterDto) {
    const { password, name, token, userStatus } = payload;
    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          // eq(TokenModel.email, email),
          eq(TokenModel.tokenHash, token),
          eq(TokenModel.type, 'registration_verification'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    if (!tok)
      throw new HttpError(400, 'Invalid or expired registration session');
    if (new Date(tok.expiresAt) < new Date())
      throw new HttpError(400, 'Registration session expired');

    if (!tok.email) {
      throw new HttpError(
        400,
        'Invalid registration session: no email associated'
      );
    }

    const email = tok.email;

    const registeredUser = await database.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({
          id: UserModel.id,
          email: UserModel.email,
          userStatus: UserModel.userStatus,
        })
        .from(UserModel)
        .where(eq(UserModel.email, email))
        .limit(1);

      if (existingUser && existingUser.userStatus !== 'Rejected') {
        throw new HttpError(400, 'Email already in use');
      }

      if (existingUser && existingUser.userStatus === 'Rejected') {
        const timestamp = Date.now();
        const newEmail = `rejected${timestamp}_${email}`;

        await tx
          .update(UserModel)
          .set({
            email: newEmail,
            userStatus: 'Rejected',
          })
          .where(eq(UserModel.id, existingUser.id));
      }

      const hashedPassword = await hashPassword(password);

      const [user] = await tx
        .insert(UserModel)
        .values({
          name: name,
          email: email,
          password: hashedPassword,
          userType: 'Admin',
          emailVerifiedAt: new Date(),
          userStatus: (userStatus || 'Pending') as
            | 'Active'
            | 'Inactive'
            | 'Blocked'
            | 'New'
            | 'Pending'
            | 'Reviewing'
            | 'Rejected',
        })
        .returning({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          userType: UserModel.userType,
        });

      // Mark session token as used
      await tx
        // .update(TokenModel)
        // .set({ used: true })
        .delete(TokenModel)
        .where(eq(TokenModel.id, tok.id));

      return {
        ...user,
        password: null,
      };
    });

    const tokens = await TokenService.issueTokenPair(registeredUser.id);

    return {
      user: registeredUser,
      ...tokens,
    };
  }

  static async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        password: UserModel.password,
        userStatus: UserModel.userStatus,
        emailVerifiedAt: UserModel.emailVerifiedAt,
        userType: UserModel.userType,
        isArchive: UserModel.isArchive,
        isUserBlocked: UserModel.isUserBlocked,
      })
      .from(UserModel)
      .where(eq(UserModel.email, email))
      .limit(1);

    if (!user) throw new HttpError(401, 'Invalid email');

    if (!user.password) {
      throw new HttpError(401, 'Invalid credentials');
    }

    const ok = await comparePassword(password, user.password);
    if (!ok) throw new HttpError(401, 'Invalid password');

    // Block archived users (deactivated due to plan limits)
    if (user.isArchive) {
      throw new HttpError(
        403,
        'Your account has been deactivated due to subscription plan limits. Please contact your clinic administrator to reactivate.'
      );
    }

    // Block explicitly blocked users
    if (user.isUserBlocked) {
      throw new HttpError(
        403,
        'Your account has been blocked. Please contact support.'
      );
    }

    this.assertCanLogin(user.userStatus);

    // Check if MFA is enabled for this user
    const mfaEnabled = await MfaService.isMfaEnabled(user.id);

    if (mfaEnabled) {
      // MFA enabled: issue limited-scope temporary token with 5-min expiry
      const tempToken = signMfaTempToken(user.id);
      return { mfaRequired: true, tempToken };
    }

    // MFA disabled: issue full access/refresh token pair. Web-only login
    // path (no device param) — defaults to the 'web' platform slot, so a
    // second web login here still replaces the prior web session, but any
    // active app-platform session (e.g. patient/social login) is untouched.
    const tokens = await TokenService.issueTokenPair(user.id, {
      ipAddress,
      userAgent,
    });

    loginAlertQueue
      .addLoginAlert({
        userId: user.id,
        userEmail: user.email ?? '',
        userName: user.name ?? '',
        loginTime: new Date().toISOString(),
        ipAddress,
        userAgent,
        // Add these from controller later
      })
      .catch((err: Error) => {
        // Login must succeed even if the alert can't be queued.
        logger.error(`Failed to queue login alert: ${err.message}`);
      });

    // Seed auto-logout session activity in Redis so the inactivity timer
    // starts immediately from login (not from the first dashboard request).
    this.seedAutoLogoutActivity(user.id).catch(() => {
      // Non-critical — don't block login
    });

    // return minimal user info + token pair

    user.password = null;
    return { user, ...tokens };
  }

  static async socialLogin(
    payload: SocialLoginDto,
    ipAddress?: string,
    userAgent?: string,
    device: 'web' | 'ios' | 'android' = 'web'
  ) {
    let profile: VerifiedSocialProfile;
    if (payload.provider === 'google') {
      profile = await verifyGoogleIdToken(payload.idToken, device);
    } else if (payload.provider === 'apple') {
      profile = await verifyAppleIdToken(payload.idToken, device, payload.name);
    } else {
      throw new HttpError(400, 'Unsupported social login provider');
    }

    const user = await database.transaction(async (tx) => {
      const conditions = [
        and(
          eq(UserModel.socialProvider, profile.provider),
          eq(UserModel.socialProviderId, profile.providerId)
        ),
      ];

      if (profile.email) {
        conditions.push(eq(UserModel.email, profile.email));
      }

      const [existingUser] = await tx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          userType: UserModel.userType,
          socialProvider: UserModel.socialProvider,
          socialProviderId: UserModel.socialProviderId,
          isArchive: UserModel.isArchive,
          isUserBlocked: UserModel.isUserBlocked,
        })
        .from(UserModel)
        .where(or(...conditions))
        .limit(1);

      if (existingUser) {
        // Block archived users (deactivated due to plan limits)
        if (existingUser.isArchive) {
          throw new HttpError(
            403,
            'Your account has been deactivated due to subscription plan limits. Please contact your clinic administrator to reactivate.'
          );
        }

        // Block explicitly blocked users
        if (existingUser.isUserBlocked) {
          throw new HttpError(
            403,
            'Your account has been blocked. Please contact support.'
          );
        }

        this.assertCanLogin(existingUser.userStatus);

        const shouldUpdateSocialIdentity =
          existingUser.socialProvider !== profile.provider ||
          existingUser.socialProviderId !== profile.providerId ||
          !existingUser.emailVerifiedAt;

        if (shouldUpdateSocialIdentity) {
          const [updatedUser] = await tx
            .update(UserModel)
            .set({
              socialProvider: profile.provider,
              socialProviderId: profile.providerId,
              emailVerifiedAt: existingUser.emailVerifiedAt || new Date(),
              updatedAt: new Date(),
            })
            .where(eq(UserModel.id, existingUser.id))
            .returning({
              id: UserModel.id,
              name: UserModel.name,
              email: UserModel.email,
              userStatus: UserModel.userStatus,
              emailVerifiedAt: UserModel.emailVerifiedAt,
              userType: UserModel.userType,
            });

          return updatedUser;
        }

        return existingUser;
      }

      const [newUser] = await tx
        .insert(UserModel)
        .values({
          name: profile.name,
          email: profile.email || null,
          socialProvider: profile.provider,
          socialProviderId: profile.providerId,
          userType: 'Admin',
          userStatus: 'New',
          emailVerifiedAt: new Date(),
        })
        .returning({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          userType: UserModel.userType,
        });

      return newUser;
    });

    const tokens = await TokenService.issueTokenPair(user.id, {
      ipAddress,
      userAgent,
      platform: device,
    });

    loginAlertQueue
      .addLoginAlert({
        userId: user.id,
        userEmail: user.email ?? '',
        userName: user.name ?? '',
        loginTime: new Date().toISOString(),
        ipAddress,
        userAgent,
      })
      .catch(() => {
        // Don't block login if alert queue is unavailable.
      });

    this.seedAutoLogoutActivity(user.id).catch(() => {
      // Non-critical — don't block login
    });

    return {
      user: {
        ...user,
        password: null,
      },
      ...tokens,
    };
  }

  /**
   * Seeds the Redis auto-logout activity key at login time so the inactivity
   * timer starts immediately rather than on the first dashboard request.
   */
  private static async seedAutoLogoutActivity(userId: string) {
    const [row] = await database
      .select({
        clinicId: ClinicModel.id,
        autoLogoutMinutes: ClinicSettingsModel.autoLogoutMinutes,
      })
      .from(ClinicModel)
      .leftJoin(
        ClinicSettingsModel,
        eq(ClinicSettingsModel.clinicId, ClinicModel.id)
      )
      .where(eq(ClinicModel.userId, userId))
      .limit(1);

    if (!row || !row.autoLogoutMinutes || row.autoLogoutMinutes <= 0) return;

    const redisKey = `session:last_activity:${row.clinicId}:${userId}`;
    const ttlSeconds = row.autoLogoutMinutes * 60 * 2;
    await redisClient.setex(redisKey, ttlSeconds, String(Date.now()));
  }

  static async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
    meta?: {
      currentToken?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ) {
    const [user] = await database
      .select({
        id: UserModel.id,
        password: UserModel.password,
        socialProvider: UserModel.socialProvider,
        userStatus: UserModel.userStatus,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) throw new HttpError(404, 'User not found');

    if (user.userStatus !== 'Active')
      throw new HttpError(403, 'Account disabled');

    const isSocialAccountWithoutPassword =
      !user.password && Boolean(user.socialProvider);

    if (!isSocialAccountWithoutPassword) {
      if (!currentPassword) throw new HttpError(400, 'Password is required');

      const isMatch = await comparePassword(currentPassword, user.password);
      if (!isMatch) throw new HttpError(400, 'Current password is incorrect');
    }

    if (currentPassword && currentPassword === newPassword)
      throw new HttpError(
        400,
        'New password cannot be the same as current password'
      );

    const hashed = await hashPassword(newPassword);
    const now = new Date();
    const pwdChangedSeconds = Math.floor(now.getTime() / 1000);

    await database
      .update(UserModel)
      .set({ password: hashed, passwordChangedAt: now })
      .where(eq(UserModel.id, userId));

    // Clear user cache and set password changed timestamp in Redis
    await redisClient.del(`user:${userId}`);
    await redisClient.setex(
      `user:password_changed_at:${userId}`,
      86400 * 30,
      String(pwdChangedSeconds)
    );

    // If current token was passed from the initiating device, allow it for a 5-minute grace period
    if (meta?.currentToken) {
      const tokenHash = hashToken(meta.currentToken);
      await redisClient.setex(
        `session:allowed_token:${userId}:${tokenHash}`,
        300,
        'true'
      );
    }

    // Revoke all previous refresh tokens for this user across devices
    await TokenService.revokeAllForUser(userId);

    // Issue a fresh token pair for this initiating device
    const tokens = await TokenService.issueTokenPair(userId, {
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      platform: 'web',
    });

    // Broadcast real-time invalidation to all other devices/sockets for this user
    realtimeBus.notifySessionInvalidated(
      userId,
      'PASSWORD_CHANGED',
      tokens.accessToken
    );

    return tokens;
  }

  static async updateReferralStatus(
    referralId: string,
    data: {
      status: 'pending' | 'approved' | 'rejected';
      comments?: string | null;
    }
  ) {
    return await database.transaction(async (tx) => {
      const existingReferral = await tx
        .select()
        .from(ReferralModel)
        .where(eq(ReferralModel.id, referralId))
        .limit(1);

      if (existingReferral.length === 0) {
        throw new HttpError(404, 'Referral not found');
      }

      const updatedReferral = await tx
        .update(ReferralModel)
        .set({
          status: data.status,
          comments: data.comments || null,
          updatedAt: new Date(),
        })
        .where(eq(ReferralModel.id, referralId))
        .returning();

      return {
        referral: updatedReferral[0],
        message: `Referral ${data.status === 'approved' ? 'approved' : data.status === 'rejected' ? 'rejected' : 'updated to pending'} successfully`,
      };
    });
  }

  static async sendEmailVerification(userId: string) {
    const [user] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);
    if (!user) throw new HttpError(404, 'User not found');

    if (user.userType === 'Patient') {
      return {
        message: 'Email verification not required for patients',
      };
    }

    const rawToken = generateTokenString();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await database
      .insert(TokenModel)
      .values({
        userId: user.id,
        tokenHash,
        type: 'email_verification',
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [TokenModel.tokenHash, TokenModel.type, TokenModel.userId],
        set: {
          userId: user.id,
          tokenHash,
          type: 'email_verification',
          expiresAt,
          used: false,
          updatedAt: new Date(),
        },
      });

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${rawToken}&uid=${user.id}`;

    // Send email asynchronously
    sendEmail(
      user.email ?? '',
      'Infinity Medisetu - Verify Your Email',
      emailVerifyHtml(user.name ?? '', verifyUrl)
    ).catch((err) => {
      logger.error(`Failed to send verification email to ${userId}:`, err);
    });

    return { message: 'Verification email sent' };
  }

  static async verifyEmail(token: string) {
    const tokenHash = hashToken(token);
    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.tokenHash, tokenHash),
          eq(TokenModel.type, 'email_verification'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    if (!tok) throw new HttpError(400, 'Invalid or expired token');
    if (!tok.userId)
      throw new HttpError(400, 'Token not associated with a user');
    if (new Date(tok.expiresAt) < new Date())
      throw new HttpError(400, 'Token expired');

    // Mark verification token as used
    await database
      // .update(TokenModel)
      // .set({ used: true })
      .delete(TokenModel)
      .where(eq(TokenModel.id, tok.id));

    // ✅ FIX: Add type assertion since we've already checked tok.userId exists
    const userId = tok.userId as string;

    // Set email as verified
    const [user] = await database
      .update(UserModel)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(UserModel.id, userId)) // ✅ Use the typed variable
      .returning({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userType: UserModel.userType,
      });

    const [clinic] = await database
      .select({
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        clinicLogo: ClinicModel.clinicLogo,
      })
      .from(ClinicAssignModel)
      .innerJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
      .where(eq(ClinicAssignModel.userId, userId)) // ✅ Use the typed variable
      .limit(1);

    // ✅ MODIFIED: Instead of generating password, send password reset link
    if (!['Super_Admin', 'Admin'].includes(user.userType)) {
      // Generate password reset token
      const resetToken = generateTokenString();
      const resetTokenHash = hashToken(resetToken);
      const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await database.insert(TokenModel).values({
        userId: userId, // ✅ Use the typed variable
        tokenHash: resetTokenHash,
        type: 'password_reset',
        expiresAt: resetExpiresAt,
      });

      // Send password setup email instead of credentials
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&userId=${userId}`;

      await sendEmail(
        user.email ?? '',
        'Infinity Medisetu - Set Your Password',
        passwordSetupEmailTemplate(
          user.name ?? '',
          clinic?.clinicName || 'Our Clinic',
          resetUrl
        )
      );
    }

    // Create user settings
    await database
      .insert(SettingModel)
      .values({ userId: userId }) // ✅ Use the typed variable
      .onConflictDoUpdate({
        target: [SettingModel.userId],
        set: { updatedAt: new Date() },
      });

    return {
      message:
        'Email verified successfully. Please check your email to set your password.',
    };
  }

  static async setInitialPassword(
    token: string,
    newPassword: string,
    name: string
  ) {
    const tokenHash = hashToken(token);
    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.tokenHash, tokenHash),
          eq(TokenModel.type, 'set_initial_password'),
          eq(TokenModel.used, false),
          gt(TokenModel.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!tok) throw new HttpError(400, 'Invalid or expired token');
    if (!tok.userId)
      throw new HttpError(400, 'Token not associated with a user');

    const userId = tok.userId as string;

    const [user] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) throw new HttpError(400, 'User not found');

    let userStatus = 'Pending';

    if (
      ['Lab_Assistant', 'Pharmacist', 'Receptionist'].includes(user.userType)
    ) {
      let clinicId: string | undefined;

      if (user.userType === 'Lab_Assistant') {
        const [assignment] = await database
          .select({ clinicId: UserLabAssignmentsModel.clinicId })
          .from(UserLabAssignmentsModel)
          .where(eq(UserLabAssignmentsModel.userId, user.id))
          .limit(1);
        if (assignment) {
          clinicId = assignment.clinicId;
        }
      } else if (user.userType === 'Pharmacist') {
        const [assignment] = await database
          .select({ clinicId: PharmacyAssignModel.clinicId })
          .from(PharmacyAssignModel)
          .where(eq(PharmacyAssignModel.userId, user.id))
          .limit(1);
        if (assignment) {
          clinicId = assignment.clinicId;
        }
      } else if (user.userType === 'Receptionist') {
        const [assignment] = await database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, user.id))
          .limit(1);
        if (assignment) {
          clinicId = assignment.clinicId;
        }
      }

      if (clinicId) {
        const [clinic] = await database
          .select({ userId: ClinicModel.userId })
          .from(ClinicModel)
          .where(eq(ClinicModel.id, clinicId))
          .limit(1);

        if (clinic) {
          const [admin] = await database
            .select({ userStatus: UserModel.userStatus })
            .from(UserModel)
            .where(eq(UserModel.id, clinic.userId))
            .limit(1);

          if (admin && admin.userStatus === 'Active') {
            userStatus = 'Active';
          }
        }
      }
    }

    const newHashed = await hashPassword(newPassword);
    const now = new Date();
    const pwdChangedSeconds = Math.floor(now.getTime() / 1000);

    await database.transaction(async (tx) => {
      await tx
        .update(UserModel)
        .set({
          name: name,
          password: newHashed,
          userStatus: userStatus as any,
          passwordChangedAt: now,
        })
        .where(eq(UserModel.id, userId));

      await tx
        // .update(TokenModel)
        // .set({ used: true })
        .delete(TokenModel)
        .where(eq(TokenModel.id, tok.id));

      await redisClient.del(`user:${userId}`);
    });

    // After commit: the name is set here, and the user may be a doctor.
    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(userId));

    await redisClient.setex(
      `user:password_changed_at:${userId}`,
      86400 * 30,
      String(pwdChangedSeconds)
    );
    await TokenService.revokeAllForUser(userId);

    return {
      success: true,
      message: 'Password set successfully. You can now login.',
    };
  }

  private static async findInviteClinicId(userId: string, clinicId: string) {
    const [clinicAssign] = await database
      .select({ clinicId: ClinicAssignModel.clinicId })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, userId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);
    if (clinicAssign) return clinicAssign.clinicId;

    const [pharmacyAssign] = await database
      .select({ clinicId: PharmacyAssignModel.clinicId })
      .from(PharmacyAssignModel)
      .where(
        and(
          eq(PharmacyAssignModel.userId, userId),
          eq(PharmacyAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);
    if (pharmacyAssign) return pharmacyAssign.clinicId;

    const [labAssign] = await database
      .select({ clinicId: UserLabAssignmentsModel.clinicId })
      .from(UserLabAssignmentsModel)
      .where(
        and(
          eq(UserLabAssignmentsModel.userId, userId),
          eq(UserLabAssignmentsModel.clinicId, clinicId)
        )
      )
      .limit(1);
    if (labAssign) return labAssign.clinicId;

    return null;
  }

  static async resendInvite(clinicId: string, userId: string) {
    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        password: UserModel.password,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) throw new HttpError(404, 'User not found');

    const memberClinicId = await UserService.findInviteClinicId(
      userId,
      clinicId
    );
    if (!memberClinicId)
      throw new HttpError(404, 'User does not belong to this clinic');

    if (!user.email)
      throw new HttpError(400, 'User has no email address on file');
    if (user.password)
      throw new HttpError(400, 'User has already set their password');

    const rawToken = generateTokenString();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    await database.transaction(async (tx) => {
      await tx
        .delete(TokenModel)
        .where(
          and(
            eq(TokenModel.userId, userId),
            eq(TokenModel.type, 'set_initial_password')
          )
        );

      await tx.insert(TokenModel).values({
        userId,
        tokenHash,
        type: 'set_initial_password',
        expiresAt,
      });
    });

    const [clinic] = await database
      .select({ clinicName: ClinicModel.clinicName })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    const clinicName = clinic?.clinicName || 'Our Clinic';
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite?token=${rawToken}&userId=${userId}&name=${encodeURIComponent(user.name ?? '')}&email=${encodeURIComponent(user.email ?? '')}`;

    await sendEmail(
      user.email,
      `Infinity Medisetu - Welcome to ${clinicName}`,
      welcomeSetPasswordTemplate({
        name: user.name ?? '',
        clinicName,
        resetUrl,
      })
    );

    return { email: user.email, expiresAt };
  }

  static async requestPasswordReset(email: string) {
    const [user] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.email, email))
      .limit(1);
    if (!user) throw new Error('User not found');

    if (user.userStatus != 'Active')
      throw new Error('User cannot reset password as the status is not Active');

    const rawToken = generateTokenString();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    const [existingToken] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.userId, user.id),
          eq(TokenModel.type, 'password_reset')
        )
      )
      .limit(1);

    if (existingToken) {
      await database
        .update(TokenModel)
        .set({
          tokenHash,
          expiresAt,
          used: false,
          updatedAt: new Date(),
        })
        .where(eq(TokenModel.id, existingToken.id));
    } else {
      await database.insert(TokenModel).values({
        userId: user.id,
        tokenHash,
        type: 'password_reset',
        expiresAt,
        used: false,
      });
    }

    // Send email asynchronously
    sendEmail(
      user.email ?? '',
      'Infinity Medisetu - Reset Your Password',
      generateResetPasswordEmail(
        { ...user, name: user.name ?? '', email: user.email ?? '' },
        rawToken,
        expiresAt
      )
    ).catch((err) => {
      logger.error(
        `Failed to send password reset email to ${user.email}:`,
        err
      );
    });

    return { message: 'Password reset email sent' };
  }

  static async resetPassword(
    token: string,
    newPassword: string,
    meta?: {
      ipAddress?: string;
      userAgent?: string;
    }
  ) {
    const tokenHash = hashToken(token);
    const [tok] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.tokenHash, tokenHash),
          eq(TokenModel.type, 'password_reset'),
          eq(TokenModel.used, false)
        )
      )
      .limit(1);

    if (!tok) throw new Error('Invalid or expired token');
    if (!tok.userId) throw new Error('Token not associated with a user');
    if (new Date(tok.expiresAt) < new Date()) throw new Error('Token expired');

    const newHashed = await hashPassword(newPassword);
    const now = new Date();
    const pwdChangedSeconds = Math.floor(now.getTime() / 1000);
    const userId = tok.userId;

    await database
      .update(UserModel)
      .set({ password: newHashed, passwordChangedAt: now })
      .where(eq(UserModel.id, userId));

    await database
      // .update(TokenModel)
      // .set({ used: true })
      .delete(TokenModel)
      .where(eq(TokenModel.id, tok.id));

    // Clear user cache and set password changed timestamp in Redis
    await redisClient.del(`user:${userId}`);
    await redisClient.setex(
      `user:password_changed_at:${userId}`,
      86400 * 30,
      String(pwdChangedSeconds)
    );

    // Revoke all previous refresh tokens for this user across all platforms/devices
    await TokenService.revokeAllForUser(userId);

    // Issue a brand new token pair for the device performing the reset
    const tokens = await TokenService.issueTokenPair(userId, {
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      platform: 'web',
    });

    // Broadcast real-time invalidation to all other devices/sockets for this user
    realtimeBus.notifySessionInvalidated(
      userId,
      'PASSWORD_RESET',
      tokens.accessToken
    );

    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    return {
      message: 'Password reset successful',
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken,
    };
  }

  static async getUser(userId: string) {
    const [user] = await database
      .select({
        id: UserModel.id,
        email: UserModel.email,
        name: UserModel.name,
        mobile: UserModel.mobile,
        address: UserProfileModel.address,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        profileImage: UserProfileModel.profileImage,
        userStatus: UserModel.userStatus,
        userType: UserModel.userType,
        password: UserModel.password,
        paymentVisible: UserModel.paymentVisible,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) return null;

    const userDetails = {
      ...user,
      yearsOfExperience: null as number | null,
    };

    // Always remove password before returning
    userDetails.password = null;

    if (userDetails.userType === 'Admin' || userDetails.userType === 'Doctor') {
      const [professionalDetails] = await database
        .select({
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
        })
        .from(UserProfessionalModel)
        .where(eq(UserProfessionalModel.userId, userId))
        .limit(1);

      userDetails.yearsOfExperience =
        professionalDetails?.yearsOfExperience ?? null;
    }

    // 1️⃣ Pharmacist → fetch pharmacy details
    if (userDetails.userType === 'Pharmacist') {
      const [pharmacyDetails] = await database
        .select({
          pharmacyId: PharmacyModel.id,
          pharmacyName: PharmacyModel.name,
          pharmacyAddress: PharmacyModel.address,
          pharmacyContactNumber: PharmacyModel.contactNumber,
          registrationNumber: PharmacyModel.registrationNumber,
          gstNumber: PharmacyModel.gstNumber,
          panNumber: PharmacyModel.panNumber,
          licenseNumber: PharmacyModel.licenseNumber,
          fssaiNumber: PharmacyModel.fssaiNumber,
          pharmacyStatus: PharmacyModel.status,
          noLoss: PharmacyModel.noLoss,
        })
        .from(PharmacyAssignModel)
        .leftJoin(
          PharmacyModel,
          eq(PharmacyModel.id, PharmacyAssignModel.pharmacyId)
        )
        .where(eq(PharmacyAssignModel.userId, userId))
        .limit(1);

      return { ...userDetails, pharmacyDetails };
    }

    // 2️⃣ Doctor → fetch doctor profile & qualifications
    if (userDetails.userType === 'Doctor') {
      const qualifications = await database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, userId));

      return {
        ...userDetails,
        qualifications,
      };
    }

    // 3️⃣ Admin → include both pharmacy details and doctor qualifications
    if (userDetails.userType === 'Admin') {
      const [pharmacyDetails] = await database
        .select({
          pharmacyId: PharmacyModel.id,
          pharmacyName: PharmacyModel.name,
          pharmacyAddress: PharmacyModel.address,
          pharmacyContactNumber: PharmacyModel.contactNumber,
          registrationNumber: PharmacyModel.registrationNumber,
          gstNumber: PharmacyModel.gstNumber,
          panNumber: PharmacyModel.panNumber,
          licenseNumber: PharmacyModel.licenseNumber,
          fssaiNumber: PharmacyModel.fssaiNumber,
          pharmacyStatus: PharmacyModel.status,
          noLoss: PharmacyModel.noLoss,
        })
        .from(PharmacyAssignModel)
        .leftJoin(
          PharmacyModel,
          eq(PharmacyModel.id, PharmacyAssignModel.pharmacyId)
        )
        .where(eq(PharmacyAssignModel.userId, userId))
        .limit(1);

      const qualifications = await database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, userId));

      let noSubscriptionTakenTillNow: boolean | undefined;

      const [assignment] = await database
        .select({ clinicId: ClinicAssignModel.clinicId })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.userId, userId))
        .limit(1);

      if (!assignment) {
        noSubscriptionTakenTillNow = true;
      } else {
        const subscriptions = await database
          .select({
            providerSubscriptionId:
              ClinicSubscriptionModel.providerSubscriptionId,
          })
          .from(ClinicSubscriptionModel)
          .where(eq(ClinicSubscriptionModel.clinicId, assignment.clinicId));

        const hasNonDefaultFree = subscriptions.some(
          (sub) => sub.providerSubscriptionId !== 'default-free'
        );

        noSubscriptionTakenTillNow = !hasNonDefaultFree;
      }

      return {
        ...userDetails,
        pharmacyDetails,
        qualifications,
        ...(noSubscriptionTakenTillNow !== undefined && {
          noSubscriptionTakenTillNow,
        }),
      };
    }

    // 4️⃣ Default → just return user
    return userDetails;
  }

  static async getUserByEmail(email: string) {
    const [user] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.email, email))
      .limit(1);
    return user;
  }
  static getBirthDateFromAge(age: number): string {
    const today = new Date();
    const birthYear = today.getFullYear() - age;
    // keep the same month/day as today
    const dob = new Date(birthYear, today.getMonth(), today.getDate());
    return dob.toISOString().split('T')[0]; // e.g. "2002-11-07"
  }
  /**
   * Creates a new patient and assigns them to a clinic.
   */
  static async createPatient(payload: CreatePetientDto, clinicId: string) {
    // Determine linking intent.
    const hasRelationship = Boolean(payload.relationship);
    const hasPrimaryRef = Boolean(
      payload.primaryPatientId || payload.primaryPatientMobile
    );

    // `relationship` and a primary reference must be provided together.
    if (hasRelationship !== hasPrimaryRef) {
      throw new HttpError(
        400,
        'To link a family member, provide both `relationship` and a primary patient reference (`primaryPatientId` or `primaryPatientMobile`).'
      );
    }

    const result = await database.transaction(async (tx) => {
      // 0. Resolve (or create) the primary patient when linking is requested.
      let primaryId: string | null = null;

      if (hasRelationship) {
        if (payload.primaryPatientId) {
          // a) Link by explicit id — must already exist and be a Patient.
          const [primary] = await tx
            .select({ id: UserModel.id })
            .from(UserModel)
            .where(
              and(
                eq(UserModel.id, payload.primaryPatientId),
                eq(UserModel.userType, 'Patient')
              )
            )
            .limit(1);

          if (!primary) {
            throw new HttpError(404, 'Primary patient not found.');
          }
          primaryId = primary.id;
        } else if (payload.primaryPatientMobile) {
          // b) Link by mobile — look up, otherwise create the primary on the fly.
          const [existingPrimary] = await tx
            .select({ id: UserModel.id })
            .from(UserModel)
            .where(
              and(
                eq(UserModel.mobile, payload.primaryPatientMobile),
                eq(UserModel.userType, 'Patient')
              )
            )
            .limit(1);

          if (existingPrimary) {
            primaryId = existingPrimary.id;
          } else {
            if (!payload.primaryPatientName) {
              throw new HttpError(
                400,
                'No patient exists with this mobile. Provide `primaryPatientName` to create the primary patient.'
              );
            }

            const [newPrimary] = await tx
              .insert(UserModel)
              .values({
                name: payload.primaryPatientName,
                mobile: payload.primaryPatientMobile,
                userType: 'Patient',
                userStatus: 'New',
              })
              .returning({ id: UserModel.id });

            if (!newPrimary) {
              throw new Error('Failed to create primary patient record');
            }
            primaryId = newPrimary.id;

            // Assign the new primary patient to the clinic.
            await tx
              .insert(ClinicAssignModel)
              .values({ userId: primaryId, clinicId })
              .onConflictDoUpdate({
                target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
                set: { updatedAt: new Date() },
              });
          }
        }
      }

      // 1. Insert the new patient into the UserModel
      // When linking as a family member, the new patient is a dependent —
      // they don't get their own mobile (mobile=NULL). Only independent
      // patients get a mobile number assigned.
      const isFamilyMember = Boolean(primaryId);

      const userInsertValues: Record<string, unknown> = {
        name: payload.name,
        mobile: isFamilyMember ? null : payload.mobile,
        userType: 'Patient' as const,
        userStatus: isFamilyMember ? ('Active' as const) : ('New' as const),
      };
      if (payload.email && payload.email.trim()) {
        userInsertValues.email = payload.email;
      }

      const [user] = await tx
        .insert(UserModel)
        .values(userInsertValues as typeof UserModel.$inferInsert)
        .returning({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
        });

      if (!user) {
        throw new Error('Failed to create patient user record');
      }

      // 2. Insert profile details into UserProfileModel
      await tx.insert(UserProfileModel).values({
        userId: user.id,
        gender: payload.gender,
        age: payload.age,
        dob: this.getBirthDateFromAge(Number(payload.age)),
        alternateMobile: payload.alternateMobile,
        address: payload.address
          ? payload.address
          : `${payload.city || ''} ${payload.state || ''} ${payload.zipCode || ''}`.trim(),
        city: payload.city,
        state: payload.state,
        zipCode: payload.zipCode,
        profileImage: payload.profileImage,
        bloodGroup: payload.bloodGroup,
        height: payload.height,
        weight: payload.weight,
        allergies: payload.allergies,
        chronicConditions: payload.chronicConditions,
      });

      // 3. Link the patient to the clinic in ClinicAssignModel
      await tx
        .insert(ClinicAssignModel)
        .values({
          userId: user.id,
          clinicId: clinicId,
        })
        .onConflictDoUpdate({
          target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
          set: {
            updatedAt: new Date(),
          },
        })
        .returning();

      // 4. Optionally link the new patient to the primary patient.
      if (primaryId) {
        if (primaryId === user.id) {
          throw new HttpError(400, 'A patient cannot be linked to themselves.');
        }
        try {
          await tx.insert(PatientFamilyLinksModel).values({
            primaryPatientId: primaryId,
            linkedPatientId: user.id,
            relationship: payload.relationship as
              'spouse' | 'child' | 'parent' | 'sibling' | 'friend' | 'other',
          });
        } catch (err: unknown) {
          // Postgres unique violation — pair already linked
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code: string }).code === '23505'
          ) {
            throw new HttpError(
              409,
              'This patient is already linked to the primary patient.'
            );
          }
          throw err;
        }
      }

      return { ...user, primaryPatientId: primaryId };
    });

    // Invalidate patient list cache for this clinic
    await UserService.invalidatePatientListCache(clinicId);
    return result;
  }

  // Update Patient details
  static async updatePatient(payload: UpdatePetientDto) {
    let user = null;
    if (payload && Object.keys(payload).length > 0) {
      // Fields that stay on UserModel
      const userSetObj: Record<string, any> = {};
      const allowedUserFields = ['name', 'email'] as const;
      for (const k of allowedUserFields) {
        const val = (payload as any)[k];
        if (typeof val !== 'undefined') userSetObj[k] = val;
      }

      // Fields that go to UserProfileModel
      const profileSetObj: Record<string, any> = {};
      const allowedProfileFields = [
        'gender',
        'age',
        'dob',
        'alternateMobile',
        'address',
        'city',
        'state',
        'zipCode',
        'profileImage',
        'bloodGroup',
        'height',
        'weight',
        'allergies',
        'chronicConditions',
      ] as const;
      for (const k of allowedProfileFields) {
        const val = (payload as any)[k];
        if (typeof val !== 'undefined') profileSetObj[k] = val;
      }

      if (Object.keys(userSetObj).length > 0) {
        userSetObj.updatedAt = sql`NOW()`;
        if (payload.name) {
          this.sendEmailVerification(payload.peteintId);
          userSetObj.emailVerifiedAt = null;
        }
        [user] = await database
          .update(UserModel)
          .set(userSetObj)
          .where(eq(UserModel.id, payload.peteintId))
          .returning({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
          });
      }

      if (Object.keys(profileSetObj).length > 0) {
        profileSetObj.updatedAt = sql`NOW()`;
        await database
          .insert(UserProfileModel)
          .values({
            userId: payload.peteintId,
            ...profileSetObj,
          })
          .onConflictDoUpdate({
            target: [UserProfileModel.userId],
            set: profileSetObj,
          });
      }

      if (!user) {
        // If only profile was updated, still return user info
        const [u] = await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
          })
          .from(UserModel)
          .where(eq(UserModel.id, payload.peteintId))
          .limit(1);
        user = u;
      }

      // Invalidate patient cache
      await redisClient.del(`patient:${payload.peteintId}`);
      await redisClient.del(`patient:${payload.peteintId}:withFamily`);
      await redisClient.del(`patient:${payload.peteintId}:v2`);
      await redisClient.del(`patient:${payload.peteintId}:withFamily:v2`);
      await redisClient.del(`patient_profile:${payload.peteintId}`);
      await redisClient.del(`patient_account:${payload.peteintId}`);

      // Invalidate patient list cache for all clinics the patient is assigned to
      try {
        const clinics = await database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, payload.peteintId));
        for (const c of clinics) {
          await UserService.invalidatePatientListCache(c.clinicId);
        }
      } catch (err) {
        logger.error(
          '[Cache] Failed to invalidate patient list cache for updated patient',
          err
        );
      }

      return user;
    }
  }
  // SECURITY: not currently routed (getPetientController in user.controller.ts
  // is unwired) — if you add a route for this, it MUST take a clinicId and
  // verify petientId is scoped to that clinic first (see assertDoctorInClinic
  // in doctor.service.ts for the pattern), or it leaks full patient PII
  // (name/email/mobile/address/DOB/allergies/blood group) cross-clinic.
  static async getPeteintById(petientId: string, includeFamilyDetails = false) {
    // Version the cache key so response-shape changes are visible immediately.
    const cacheKey = includeFamilyDetails
      ? `patient:${petientId}:withFamily`
      : `patient:${petientId}`;
    const versionedCacheKey = `${cacheKey}:v2`;
    const cached = await redisClient.get(versionedCacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [user] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        createdAt: UserModel.createdAt,
        updatedAt: UserModel.updatedAt,
        gender: UserProfileModel.gender,
        age: UserProfileModel.age,
        dob: UserProfileModel.dob,
        alternateMobile: UserProfileModel.alternateMobile,
        address: UserProfileModel.address,
        city: UserProfileModel.city,
        state: UserProfileModel.state,
        zipCode: UserProfileModel.zipCode,
        profileImage: UserProfileModel.profileImage,
        bloodGroup: UserProfileModel.bloodGroup,
        height: UserProfileModel.height,
        weight: UserProfileModel.weight,
        allergies: UserProfileModel.allergies,
        chronicConditions: UserProfileModel.chronicConditions,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, petientId))
      .limit(1);

    if (!user) return null;

    // Fetch stats in parallel
    const [appointmentStats, reportStats] = await Promise.all([
      database
        .select({
          totalAppointments: sql<number>`COUNT(*)::int`,
          lastVisit: sql<
            string | null
          >`MAX(${AppointmentModel.appointmentDate})`,
          totalPaidPayments: sql<number>`COALESCE(SUM(CASE WHEN ${AppointmentPaymentModel.paymentStatus} = 'Paid' THEN ${AppointmentPaymentModel.price}::numeric ELSE 0 END), 0)::numeric`,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(eq(AppointmentModel.patientId, petientId)),
      database
        .select({
          totalReports: sql<number>`COUNT(*)::int`,
        })
        .from(ReportsModel)
        .where(eq(ReportsModel.petientId, petientId)),
    ]);

    const result: Record<string, unknown> = {
      ...user,
      lastVisit: appointmentStats[0]?.lastVisit || null,
      totalAppointments: appointmentStats[0]?.totalAppointments || 0,
      totalPaidPayments: Number(appointmentStats[0]?.totalPaidPayments) || 0,
      totalReports: reportStats[0]?.totalReports || 0,
    };

    // If patient has no mobile, find linked number from family links
    if (!user.mobile) {
      const [asLinked] = await database
        .select({
          primaryMobile: UserModel.mobile,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
        )
        .where(eq(PatientFamilyLinksModel.linkedPatientId, petientId))
        .limit(1);

      result.linkedNumber = asLinked?.primaryMobile || null;
    }

    // Optionally include family members
    if (includeFamilyDetails) {
      const familyMembers = await database
        .select({
          id: PatientFamilyLinksModel.linkedPatientId,
          name: UserModel.name,
          mobile: UserModel.mobile,
          relationship: PatientFamilyLinksModel.relationship,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
        )
        .where(eq(PatientFamilyLinksModel.primaryPatientId, petientId));

      result.familyMembers = familyMembers;
    }

    // Cache for 10 minutes
    await redisClient.setex(versionedCacheKey, 600, JSON.stringify(result));

    return result;
  }
  static escapeLike(s: string) {
    return s.replace(/[%_\\]/g, (m) => `\\${m}`);
  }

  //     const rawPatientId = query?.patientId;
  //     const patientId =
  //       rawPatientId && rawPatientId !== 'null' && rawPatientId !== 'undefined'
  //         ? String(rawPatientId)
  //         : undefined;

  //     // Build conditions directly — no need to fetch all IDs first
  //     const conditions: SQL[] = [];

  //     if (patientId) {
  //       conditions.push(eq(UserModel.id, patientId));
  //     }

  //     const totalCount = Number(totalRecords[0]?.count) || 0;
  //     const totalPages = Math.ceil(totalCount / pageSize);

  //     // Fetch family member links for all patients in this page
  //     const patientIds = petients.map((p) => p.id);

  //   return result;
  // }

  static async getAllPeteints(
    clinicId: string,
    query: getAllPetientsDto,
    user: AuthUser
  ) {
    const sortedQueryString = Object.keys(query)
      .sort()
      .map((k) => `${k}:${(query as any)[k]}`)
      .join('|');
    const queryHash = crypto
      .createHash('md5')
      .update(sortedQueryString)
      .digest('hex');
    const cacheKey = `patients:list:${clinicId}:${user.id}:${queryHash}`;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[Cache] Redis read error for patient list', err);
    }

    const result = await database.transaction(async (tx) => {
      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      const rawPatientId = query?.patientId;
      const patientId =
        rawPatientId && rawPatientId !== 'null' && rawPatientId !== 'undefined'
          ? String(rawPatientId)
          : undefined;

      const conditions: SQL[] = [];

      if (user.userType === 'Doctor' && !patientId) {
        const doctorPatientIds = tx
          .selectDistinct({
            id: AppointmentModel.patientId,
          })
          .from(AppointmentModel)
          .where(eq(AppointmentModel.doctorId, user.id));

        conditions.push(sql`${UserModel.id} IN (${doctorPatientIds})`);
      } else {
        conditions.push(eq(UserModel.userType, 'Patient'));

        conditions.push(
          sql`
            ${UserModel.id} IN (
              SELECT user_id
              FROM clinic_assign
              WHERE clinic_id = ${clinicId}
            )
          `
        );
      }

      if (patientId) {
        conditions.push(eq(UserModel.id, patientId));
      }

      if (query?.searchBy) {
        const raw = String(query.searchBy).trim();
        if (raw.length > 0) {
          const terms = raw.split(/\s+/).slice(0, 5);

          const termConditions = terms
            .map((term) => {
              const escaped = this.escapeLike(term);
              const pattern = `%${escaped}%`.toLowerCase();

              const byName = sql`
                lower(${UserModel.name}) LIKE ${pattern}
              `;

              const byEmail = sql`
                lower(${UserModel.email}) LIKE ${pattern}
              `;

              const byMobile = sql`
                lower(${UserModel.mobile}) LIKE ${pattern}
              `;

              const byAltMobile = sql`
                lower(${UserProfileModel.alternateMobile}) LIKE ${pattern}
              `;

              return or(byName, byEmail, byMobile, byAltMobile);
            })
            .filter((c): c is SQL => c !== undefined);

          if (termConditions.length === 1) {
            conditions.push(termConditions[0]);
          } else if (termConditions.length > 1) {
            const andCondition = and(...termConditions);

            if (andCondition) {
              conditions.push(andCondition);
            }
          }
        }
      }

      if (query?.userStatus) {
        conditions.push(eq(UserModel.userStatus, query.userStatus));
      }

      if (query?.userType) {
        conditions.push(eq(UserModel.userType, query.userType));
      }

      if (query?.gender) {
        conditions.push(eq(UserProfileModel.gender, query.gender));
      }
      if (query?.startDate) {
        const start = new Date(query.startDate);

        start.setUTCHours(0, 0, 0, 0);

        conditions.push(gte(UserModel.createdAt, start));
      }
      if (query?.endDate) {
        const end = new Date(query.endDate);

        end.setUTCHours(23, 59, 59, 999);

        conditions.push(lte(UserModel.createdAt, end));
      }

      if (query?.minAge) {
        conditions.push(gte(UserProfileModel.age, Number(query.minAge)));
      }

      if (query?.maxAge) {
        conditions.push(lte(UserProfileModel.age, Number(query.maxAge)));
      }

      let visitStartDate: Date | undefined;
      let visitEndDate: Date | undefined;

      const now = new Date();

      if (query.visitRange === 'yesterday') {
        visitStartDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - 1,
            0,
            0,
            0,
            0
          )
        );

        visitEndDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - 1,
            23,
            59,
            59,
            999
          )
        );
      } else if (query.visitRange === 'today') {
        visitStartDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            0,
            0,
            0,
            0
          )
        );

        visitEndDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            23,
            59,
            59,
            999
          )
        );
      } else if (query.visitRange === 'week') {
        const weekDay = now.getUTCDay();

        const diffMon = weekDay === 0 ? 6 : weekDay - 1;

        visitStartDate = new Date(now);

        visitStartDate.setUTCDate(now.getUTCDate() - diffMon);

        visitStartDate.setUTCHours(0, 0, 0, 0);

        visitEndDate = new Date(visitStartDate);

        visitEndDate.setUTCDate(visitStartDate.getUTCDate() + 6);

        visitEndDate.setUTCHours(23, 59, 59, 999);
      } else if (query.visitRange === 'month') {
        visitStartDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
        );

        visitEndDate = new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            0,
            23,
            59,
            59,
            999
          )
        );
      } else if (
        query.visitRange === 'custom' ||
        (!query.visitRange && (query.visitStartDate || query.visitEndDate))
      ) {
        if (query.visitStartDate) {
          visitStartDate = new Date(query.visitStartDate);

          visitStartDate.setUTCHours(0, 0, 0, 0);
        }

        if (query.visitEndDate) {
          visitEndDate = new Date(query.visitEndDate);

          visitEndDate.setUTCHours(23, 59, 59, 999);
        }
      }

      const visitCountConditions: SQL[] = [
        eq(AppointmentModel.clinicId, clinicId),

        eq(AppointmentModel.patientId, UserModel.id),
      ];

      if (user.userType === 'Doctor') {
        visitCountConditions.push(eq(AppointmentModel.doctorId, user.id));
      } else if (query.doctorId) {
        visitCountConditions.push(
          eq(AppointmentModel.doctorId, query.doctorId)
        );
      }

      if (visitStartDate) {
        visitCountConditions.push(
          gte(AppointmentModel.appointmentDate, visitStartDate)
        );
      }

      if (visitEndDate) {
        visitCountConditions.push(
          lte(AppointmentModel.appointmentDate, visitEndDate)
        );
      }

      const visitCountSql = sql<number>`
        (
          SELECT COUNT(*)::int
          FROM ${AppointmentModel}
          WHERE ${and(...visitCountConditions)}
        )
      `;

      const sortBy = query.sortBy || 'createdAt';

      const sortOrder = query.sortOrder || (sortBy === 'name' ? 'asc' : 'desc');

      let orderByCondition: SQL;

      if (sortBy === 'visitCount') {
        orderByCondition =
          sortOrder === 'asc' ? asc(visitCountSql) : desc(visitCountSql);
      } else if (sortBy === 'name') {
        orderByCondition =
          sortOrder === 'asc' ? asc(UserModel.name) : desc(UserModel.name);
      } else {
        orderByCondition =
          sortOrder === 'asc'
            ? asc(UserModel.createdAt)
            : desc(UserModel.createdAt);
      }

      const [totalRecords, petients] = await Promise.all([
        tx
          .select({
            count: sql<number>`
                COUNT(DISTINCT ${UserModel.id})
              `,
          })
          .from(UserModel)
          .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
          .where(and(...conditions)),

        tx
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            mobile: UserModel.mobile,

            gender: UserProfileModel.gender,
            age: UserProfileModel.age,
            dob: UserProfileModel.dob,
            alternateMobile: UserProfileModel.alternateMobile,
            profileImage: UserProfileModel.profileImage,
            address: UserProfileModel.address,
            city: UserProfileModel.city,

            status: UserModel.userStatus,

            updatedAt: UserModel.updatedAt,

            createdAt: UserModel.createdAt,

            visitCount: visitCountSql,
          })
          .from(UserModel)
          .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
          .where(and(...conditions))
          .orderBy(orderByCondition, desc(UserModel.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const totalCount = Number(totalRecords[0]?.count) || 0;

      const totalPages = Math.ceil(totalCount / pageSize);

      const patientIds = petients.map((p) => p.id);

      const familyMap: Record<
        string,
        {
          id: string;
          name: string | null;
          mobile: string | null;
          relationship: string;
        }[]
      > = {};

      if (patientIds.length > 0) {
        const familyLinks = await tx
          .select({
            primaryPatientId: PatientFamilyLinksModel.primaryPatientId,

            linkedId: UserModel.id,

            linkedName: UserModel.name,

            linkedMobile: UserModel.mobile,

            relationship: PatientFamilyLinksModel.relationship,
          })
          .from(PatientFamilyLinksModel)
          .innerJoin(
            UserModel,
            eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
          )
          .where(inArray(PatientFamilyLinksModel.primaryPatientId, patientIds));

        for (const link of familyLinks) {
          if (!familyMap[link.primaryPatientId]) {
            familyMap[link.primaryPatientId] = [];
          }

          familyMap[link.primaryPatientId].push({
            id: link.linkedId,
            name: link.linkedName,
            mobile: link.linkedMobile,
            relationship: link.relationship,
          });
        }

        const reverseLinks = await tx
          .select({
            linkedPatientId: PatientFamilyLinksModel.linkedPatientId,

            primaryId: UserModel.id,

            primaryName: UserModel.name,

            primaryMobile: UserModel.mobile,

            relationship: PatientFamilyLinksModel.relationship,
          })
          .from(PatientFamilyLinksModel)
          .innerJoin(
            UserModel,
            eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
          )
          .where(inArray(PatientFamilyLinksModel.linkedPatientId, patientIds));

        for (const link of reverseLinks) {
          if (!familyMap[link.linkedPatientId]) {
            familyMap[link.linkedPatientId] = [];
          }

          familyMap[link.linkedPatientId].push({
            id: link.primaryId,
            name: link.primaryName,
            mobile: link.primaryMobile,
            relationship: link.relationship,
          });
        }
      }

      const patientsWithFamily = petients.map((p) => ({
        ...p,

        familyMembers: familyMap[p.id] || [],

        linkedNumber: familyMap[p.id]?.find((f) => f.mobile)?.mobile || null,

        visitCount: Number(p.visitCount || 0),
      }));

      return {
        petients: patientsWithFamily,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });

    try {
      await redisClient.setex(cacheKey, 600, JSON.stringify(result));
    } catch (err) {
      logger.warn('[Cache] Redis write error for patient list', err);
    }

    return result;
  }

  static async invalidatePatientListCache(clinicId: string) {
    try {
      const keys = await redisClient.keys(`patients:list:${clinicId}:*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {
      logger.error('[Cache] Failed to invalidate patient list cache', err);
    }
  }

  static async addUser(clinicId: string, payload: addUserDto) {
    const result = await database.transaction(async (tx) => {
      // 🔍 Build conditions safely (mobile may be undefined)
      const conditions = [];

      if (payload.email) {
        conditions.push(eq(UserModel.email, payload.email));
      }

      if (payload.mobile) {
        conditions.push(eq(UserModel.mobile, payload.mobile));
      }

      const existing = await tx
        .select({
          id: UserModel.id,
          email: UserModel.email,
          mobile: UserModel.mobile,
          userStatus: UserModel.userStatus,
        })
        .from(UserModel)
        .where(or(...conditions))
        .limit(1);

      if (existing.length) {
        const user = existing[0];
        const emailMatch = payload.email && user.email === payload.email;
        const mobileMatch = payload.mobile && user.mobile === payload.mobile;
        const isRejected = user.userStatus === 'Rejected';

        if (isRejected) {
          const timestamp = Date.now();

          if (emailMatch) {
            const archivedEmail = `rejected${timestamp}_${payload.email}`;
            await tx
              .update(UserModel)
              .set({
                email: archivedEmail,
                userStatus: 'Rejected',
                updatedAt: new Date(),
              })
              .where(eq(UserModel.id, user.id));
          }

          if (mobileMatch && payload.mobile) {
            const archivedMobile = `rejected${timestamp}_${payload.mobile}`;
            await tx
              .update(UserModel)
              .set({
                mobile: archivedMobile,
                userStatus: 'Rejected',
                updatedAt: new Date(),
              })
              .where(eq(UserModel.id, user.id));
          }
        } else {
          if (emailMatch && mobileMatch) {
            throw new HttpError(
              400,
              'User with this email and mobile already exists'
            );
          } else if (emailMatch) {
            throw new HttpError(400, 'Email already in use');
          }
        }
      }

      const [user] = await tx
        .insert(UserModel)
        .values({
          name: payload.name,
          email: payload.email,
          mobile: payload.mobile,
          userType: payload.userType,
          emailVerifiedAt: new Date(),
          userStatus: 'New',
        })
        .returning({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          userType: UserModel.userType,
        });

      // Insert professional details if provided
      if (payload.speciality || payload.registrationNumber) {
        await tx.insert(UserProfessionalModel).values({
          userId: user.id,
          speciality: payload.speciality,
          registrationNumber: payload.registrationNumber,
        });
      }

      const resetToken = generateTokenString();
      const resetTokenHash = hashToken(resetToken);
      const resetExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

      await tx
        .insert(TokenModel)
        .values({
          userId: user.id,
          tokenHash: resetTokenHash,
          type: 'set_initial_password',
          expiresAt: resetExpiresAt,
        })
        .onConflictDoUpdate({
          target: [TokenModel.tokenHash, TokenModel.type, TokenModel.userId],
          set: {
            tokenHash: resetTokenHash,
            expiresAt: resetExpiresAt,
            used: false,
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(ClinicAssignModel)
        .values({ userId: user.id, clinicId })
        .onConflictDoUpdate({
          target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
          set: { updatedAt: new Date() },
        });

      const [clinic] = await tx
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId));

      await tx
        .insert(SettingModel)
        .values({ userId: user.id })
        .onConflictDoUpdate({
          target: [SettingModel.userId],
          set: { updatedAt: new Date() },
        });

      return { user, resetToken, clinic };
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite?token=${result.resetToken}&userId=${result.user.id}&name=${encodeURIComponent(result.user.name ?? '')}&email=${encodeURIComponent(result.user.email ?? '')}`;

    setImmediate(() => {
      sendEmail(
        result.user.email ?? '',
        `Infinity Medisetu - Welcome to ${result.clinic?.clinicName || 'Our Clinic'}`,
        welcomeSetPasswordTemplate({
          name: result.user.name ?? '',
          clinicName: result.clinic?.clinicName || 'Our Clinic',
          resetUrl,
        })
      ).catch(console.error);
    });

    await UserService.invalidateUsersListCache(clinicId);
    await UserService.invalidateDoctorListCache(clinicId);

    if ((payload.userType as string) === 'Patient') {
      await UserService.invalidatePatientListCache(clinicId);
    }
    return result.user;
  }

  static async updateAdminPermissionToDoctor(
    userId: string,
    payload: updateAdminPermissionToDoctorDto
  ) {
    return await database.transaction(async (tx) => {
      const result = await tx
        .update(UserModel)
        .set({
          isAdminDoctorAccess: payload.isAdminDoctorAccess,
        })
        .where(eq(UserModel.id, userId))
        .returning({
          id: UserModel.id,
          isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        });

      // Invalidate user cache
      await redisClient.del(`user:${userId}`);

      try {
        const clinics = await tx
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, userId));
        for (const c of clinics) {
          await UserService.invalidateUsersListCache(c.clinicId);
          await UserService.invalidateDoctorListCache(c.clinicId);
        }
      } catch (err) {
        logger.error(
          '[Cache] Failed to invalidate users list cache on doctor-access toggle',
          err
        );
      }

      return result;
    });
  }

  // Mirrors requireAddUserLimit — reactivating is as capacity-relevant as creating.
  private static async assertCanActivate(
    clinicId: string,
    userType: string
  ): Promise<void> {
    if (userType === 'Doctor') {
      const result = await LimitationService.checkDoctorLimit(clinicId);
      if (!result.allowed) {
        throw new HttpError(
          403,
          result.message || 'Doctor account limit reached on your current plan.'
        );
      }
      return;
    }

    if (STAFF_USER_TYPES.includes(userType as StaffUserType)) {
      const result = await LimitationService.checkStaffLimit(clinicId);
      if (!result.allowed) {
        throw new HttpError(
          403,
          result.message || 'Staff account limit reached on your current plan.'
        );
      }
    }
  }

  static async updateUser(
    userId: string,
    clinicId: string,
    payload: UpdateUserInput,
    performedByUserId?: string
  ) {
    let isDeactivating = false;

    const result = await database.transaction(async (tx) => {
      // ... existing code ...
      // 1️⃣ Check user exists
      const [existingUser] = await tx
        .select({
          id: UserModel.id,
          email: UserModel.email,
          mobile: UserModel.mobile,
          userType: UserModel.userType,
          userStatus: UserModel.userStatus,
          isArchive: UserModel.isArchive,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);

      if (!existingUser) {
        throw new HttpError(404, 'User not found');
      }

      const isReactivating =
        payload.userStatus === 'Active' && existingUser.userStatus !== 'Active';
      isDeactivating =
        payload.userStatus != null &&
        payload.userStatus !== 'Active' &&
        ['Inactive', 'Rejected', 'Blocked'].includes(payload.userStatus);

      if (isReactivating && existingUser.userType !== 'Admin') {
        await UserService.assertCanActivate(clinicId, existingUser.userType);
      }

      // Ownership check: an Admin may only update users assigned to their
      // own clinic. Without this, any clinic's Admin could edit another
      // clinic's user by userId (name/email/mobile/type/status).
      const [assignment] = await tx
        .select({ id: ClinicAssignModel.id })
        .from(ClinicAssignModel)
        .where(
          and(
            eq(ClinicAssignModel.userId, userId),
            eq(ClinicAssignModel.clinicId, clinicId)
          )
        )
        .limit(1);

      if (!assignment) {
        throw new HttpError(
          403,
          'Access denied. User is not assigned to this clinic.'
        );
      }

      // 2️⃣ Duplicate email / mobile check (exclude current user)
      const conditions = [];

      if (payload.email) {
        conditions.push(eq(UserModel.email, payload.email));
      }

      // if (payload.mobile) {
      //   conditions.push(eq(UserModel.mobile, payload.mobile));
      // }

      if (conditions.length) {
        const [duplicate] = await tx
          .select({
            id: UserModel.id,
            email: UserModel.email,
            mobile: UserModel.mobile,
          })
          .from(UserModel)
          .where(and(ne(UserModel.id, userId), or(...conditions)))
          .limit(1);

        if (duplicate) {
          if (payload.email && duplicate.email === payload.email) {
            throw new HttpError(400, 'Email already in use');
          }
        }
      }

      // 3️⃣ Update user
      const [updatedUser] = await tx
        .update(UserModel)
        .set({
          ...payload,
          ...(isReactivating ? { isArchive: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(UserModel.id, userId))
        .returning({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          userType: UserModel.userType,
          userStatus: UserModel.userStatus,
        });

      // 4️⃣ Update clinic assignment (if exists)
      await tx
        .insert(ClinicAssignModel)
        .values({ userId, clinicId })
        .onConflictDoUpdate({
          target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
          set: { updatedAt: new Date() },
        });

      // Invalidate user cache
      await redisClient.del(`user:${userId}`);
      await UserService.invalidateUsersListCache(clinicId);
      await UserService.invalidateDoctorListCache(clinicId);

      if (updatedUser.userType === 'Patient') {
        await UserService.invalidatePatientListCache(clinicId);
      }

      return updatedUser;
    });

    // After commit: payload may rename a doctor (public profile + push name).
    if (result.userType === 'Doctor') {
      await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(userId));
    }

    // Runs after commit; a revoke failure here must not roll back the status change.
    if (isDeactivating) {
      try {
        await PermissionService.revokeAllForUser(
          userId,
          clinicId,
          performedByUserId ?? userId
        );
      } catch (err) {
        logger.error(
          `[UserService] Failed to revoke permissions for deactivated user=${userId}`,
          err
        );
      }
    }

    return result;
  }

  /**
   * Translate a clinic owner's account status into the clinic's own status.
   * Returns `null` for statuses that carry no clinic meaning (e.g. 'New'),
   * in which case the clinic row is left untouched.
   */
  private static mapUserStatusToClinicStatus(
    userStatus: string
  ): 'Active' | 'Inactive' | 'Blocked' | 'Pending' | 'Rejected' | null {
    switch (userStatus) {
      case 'Active':
        return 'Active';
      case 'Inactive':
        return 'Inactive';
      case 'Blocked':
        return 'Blocked';
      case 'Rejected':
        return 'Rejected';
      case 'Pending':
      case 'Reviewing':
        return 'Pending';
      default:
        return null;
    }
  }

  static async updateUserStatus(
    userId: string,
    payload: { userStatus?: string; reason?: string; changedBy?: string },
    options: { skipLimitCheck?: boolean; performedByUserId?: string } = {}
  ) {
    const { userStatus, changedBy = 'System Administrator' } = payload;

    if (!userStatus) {
      throw new Error('userStatus is required');
    }

    if (userStatus === 'Pending') {
      throw new Error(
        'You cannot change user status to pending, because user has already been registered.'
      );
    }

    const [existingUser] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!existingUser) {
      throw new Error('User not found');
    }

    const oldStatus = existingUser.userStatus || 'New';

    const isReactivating = userStatus === 'Active' && oldStatus !== 'Active';
    const isDeactivating = ['Inactive', 'Rejected', 'Blocked'].includes(
      userStatus
    );

    // An Admin's own activation drives the clinic sync below, not a staff/doctor seat.
    let resolvedClinicId: string | undefined;
    if (
      (isReactivating || isDeactivating) &&
      existingUser.userType !== 'Admin'
    ) {
      const [clinicAssign] = await database
        .select({ clinicId: ClinicAssignModel.clinicId })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.userId, userId))
        .limit(1);
      resolvedClinicId = clinicAssign?.clinicId;
    }

    // skipLimitCheck is set only by the cascaded pending-team-member activation below.
    if (isReactivating && resolvedClinicId && !options.skipLimitCheck) {
      await UserService.assertCanActivate(
        resolvedClinicId,
        existingUser.userType
      );
    }

    // Update user status
    const [updatedUser] = await database
      .update(UserModel)
      .set({
        userStatus: userStatus as any,
        ...(isReactivating ? { isArchive: false } : {}),
        updatedAt: new Date(),
      })
      .where(eq(UserModel.id, userId))
      .returning({
        id: UserModel.id,
        name: UserModel.name,
        userName: UserModel.userName,
        email: UserModel.email,
        mobile: UserModel.mobile,
        socialProvider: UserModel.socialProvider,
        socialProviderId: UserModel.socialProviderId,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        emailVerifiedAt: UserModel.emailVerifiedAt,
        isUserBlocked: UserModel.isUserBlocked,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        isArchive: UserModel.isArchive,
        paymentVisible: UserModel.paymentVisible,
        passwordChangedAt: UserModel.passwordChangedAt,
        createdAt: UserModel.createdAt,
        updatedAt: UserModel.updatedAt,
      });

    // Invalidate user auth cache so middleware picks up new status immediately
    await redisClient.del(`user:${userId}`);

    // A revoke failure here must not roll back the status change itself.
    if (isDeactivating && resolvedClinicId) {
      try {
        await PermissionService.revokeAllForUser(
          userId,
          resolvedClinicId,
          options.performedByUserId ?? userId
        );
      } catch (err) {
        logger.error(
          `[UserService] Failed to revoke permissions for deactivated user=${userId}`,
          err
        );
      }
    }

    // Keep the clinic's lifecycle in sync with its owner's approval state.
    // The owner (Admin) is the approval subject, so only their status counts.
    if (existingUser.userType === 'Admin') {
      const clinicStatus = UserService.mapUserStatusToClinicStatus(userStatus);

      if (clinicStatus) {
        const [syncedClinic] = await database
          .update(ClinicModel)
          .set({ status: clinicStatus, updatedAt: new Date() })
          .where(eq(ClinicModel.userId, userId))
          .returning({ id: ClinicModel.id });

        if (syncedClinic) {
          await redisClient.del(`clinic_details:${syncedClinic.id}`);
          // requireClinic caches status per member — drop every attached user's entry
          const members = await database
            .select({ userId: ClinicAssignModel.userId })
            .from(ClinicAssignModel)
            .where(eq(ClinicAssignModel.clinicId, syncedClinic.id));

          await Promise.all([
            redisClient.del(`user_clinic:${userId}`),
            ...members.map((m) => redisClient.del(`user_clinic:${m.userId}`)),
          ]);
        }
      }
    }

    if (existingUser.userType === 'Admin' && userStatus === 'Active') {
      let clinicId: string | undefined;

      const [clinic] = await database
        .select({ id: ClinicModel.id })
        .from(ClinicModel)
        .where(eq(ClinicModel.userId, userId))
        .limit(1);

      if (clinic) {
        clinicId = clinic.id;
      } else {
        const [clinicAssign] = await database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, userId))
          .limit(1);
        if (clinicAssign) {
          clinicId = clinicAssign.clinicId;
        }
      }

      if (clinicId) {
        // Find Lab Assistants associated with this clinicId in user_lab_assignments who are 'Pending'
        const pendingLabAssistants = await database
          .select({ userId: UserLabAssignmentsModel.userId })
          .from(UserLabAssignmentsModel)
          .innerJoin(
            UserModel,
            eq(UserLabAssignmentsModel.userId, UserModel.id)
          )
          .where(
            and(
              eq(UserLabAssignmentsModel.clinicId, clinicId),
              eq(UserModel.userType, 'Lab_Assistant'),
              eq(UserModel.userStatus, 'Pending')
            )
          );

        // Find Pharmacists associated with this clinicId in pharmacy_assign who are 'Pending'
        const pendingPharmacists = await database
          .select({ userId: PharmacyAssignModel.userId })
          .from(PharmacyAssignModel)
          .innerJoin(UserModel, eq(PharmacyAssignModel.userId, UserModel.id))
          .where(
            and(
              eq(PharmacyAssignModel.clinicId, clinicId),
              eq(UserModel.userType, 'Pharmacist'),
              eq(UserModel.userStatus, 'Pending')
            )
          );

        // Find Receptionists associated with this clinicId in clinic_assign who are 'Pending'
        const pendingReceptionists = await database
          .select({ userId: ClinicAssignModel.userId })
          .from(ClinicAssignModel)
          .innerJoin(UserModel, eq(ClinicAssignModel.userId, UserModel.id))
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              eq(UserModel.userType, 'Receptionist'),
              eq(UserModel.userStatus, 'Pending')
            )
          );

        const teamMembersToActivate = [
          ...pendingLabAssistants.map((la) => la.userId),
          ...pendingPharmacists.map((p) => p.userId),
          ...pendingReceptionists.map((r) => r.userId),
        ];

        await Promise.all(
          teamMembersToActivate.map((memberId) =>
            // Rides on the Admin's own already-approved activation, so not re-gated here.
            UserService.updateUserStatus(
              memberId,
              { userStatus: 'Active', changedBy: changedBy },
              { skipLimitCheck: true }
            )
          )
        );
      }
    }

    if (
      existingUser.userType === 'Admin' &&
      oldStatus === 'Pending' &&
      userStatus === 'Active'
    ) {
      const [clinic] = await database
        .select({ id: ClinicModel.id })
        .from(ClinicModel)
        .where(eq(ClinicModel.userId, userId))
        .limit(1);

      if (clinic) {
        const startsAt = new Date();
        const expiresAt = new Date(startsAt);
        expiresAt.setDate(expiresAt.getDate() + 30);

        const [subscription] = await database
          .select({ id: ClinicSubscriptionModel.id })
          .from(ClinicSubscriptionModel)
          .where(eq(ClinicSubscriptionModel.clinicId, clinic.id))
          .orderBy(desc(ClinicSubscriptionModel.createdAt))
          .limit(1);

        if (subscription) {
          await database
            .update(ClinicSubscriptionModel)
            .set({
              startsAt,
              expiresAt,
              active: true,
              updatedAt: startsAt,
            })
            .where(eq(ClinicSubscriptionModel.id, subscription.id));

          await redisClient.del(`clinic_active_subscription:${clinic.id}`);
          await redisClient.del(`clinic_plan:${clinic.id}`);
          await redisClient.del(`clinic_details:${clinic.id}`);

          await SubscriptionService.updateUserSubscriptionExpiryCache(
            clinic.id,
            expiresAt
          );
        }
      }
    }

    // Send email notification only for Admin and Doctor user types
    if (
      existingUser.userType === 'Admin' ||
      existingUser.userType === 'Doctor'
    ) {
      try {
        // Get clinic information
        let clinicName = 'your clinic';
        const [clinicAssign] = await database
          .select()
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, userId))
          .limit(1);

        if (clinicAssign) {
          const [clinic] = await database
            .select({ clinicName: ClinicModel.clinicName })
            .from(ClinicModel)
            .where(eq(ClinicModel.id, clinicAssign.clinicId))
            .limit(1);

          clinicName = clinic?.clinicName || 'your clinic';
        }

        const emailHtml = doctorStatusChangeTemplate({
          doctorName: existingUser.name || 'Doctor',
          clinicName: clinicName,
          oldStatus: oldStatus,
          newStatus: userStatus,
          changedBy: changedBy,
          changedAt: new Date(),
          loginUrl:
            process.env.LOGIN_URL || 'https://infinitymedisetu.com/app/login',
          supportEmail:
            process.env.SUPPORT_EMAIL || 'support@infinitymedisetu.com',
        });

        await sendEmail(
          updatedUser.email ?? '',
          `Infinity Medisetu - Account Status Updated as ${userStatus}`,
          emailHtml
        );

        logger.info(
          `Status change email sent to ${updatedUser.email} for user ${userId}`
        );
      } catch (emailError) {
        logger.error(
          `Failed to send status change email to ${updatedUser.email}:`,
          emailError
        );
      }
    }

    try {
      const clinics = await database
        .select({ clinicId: ClinicAssignModel.clinicId })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.userId, userId));
      for (const c of clinics) {
        await UserService.invalidateUsersListCache(c.clinicId);
        await UserService.invalidateDoctorListCache(c.clinicId);
        if (existingUser.userType === 'Patient') {
          await UserService.invalidatePatientListCache(c.clinicId);
        }
        // Realtime: the staff directory and any presence indicator watching
        // this clinic previously only learned of an approval/active/suspend
        // change on a manual refresh (docs/REALTIME_ROLLOUT_PLAN.md Phase 5).
        // Cascaded team-member activation above recurses into this same
        // method, so each of those members signals too — not just the admin.
        realtimeBus.notify(
          target.staff(c.clinicId),
          `staff.status_${String(userStatus).toLowerCase()}`
        );
      }
    } catch (err) {
      logger.error(
        '[Cache] Failed to invalidate users list cache on status update',
        err
      );
    }

    return updatedUser;
  }

  static async activateDoctor(doctorId: string) {
    const [user] = await database
      .select({
        id: UserModel.id,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
      })
      .from(UserModel)
      .where(eq(UserModel.id, doctorId))
      .limit(1);

    if (!user) throw new HttpError(404, 'Doctor not found');
    if (user.userType !== 'Doctor')
      throw new HttpError(400, 'User is not a doctor');

    if (user.userStatus !== 'Pending') {
      return {
        updated: false,
        userStatus: user.userStatus,
        message: `Doctor status is already ${user.userStatus}; no change made.`,
      };
    }

    const updatedUser = await UserService.updateUserStatus(doctorId, {
      userStatus: 'Active',
    });

    return {
      updated: true,
      userStatus: updatedUser.userStatus,
      user: updatedUser,
    };
  }

  /**
   * Update clinic onboarding progress
   * @param userId - The user ID (clinic owner)
   * @param data - Onboarding data to update
   */
  static async updateOnboardingProgress(
    userId: string,
    data: {
      onboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
      approvalRequestSent?: boolean;
      currentStep?: number;
    }
  ) {
    // Find the clinic for this user
    const [clinic] = await database
      .select()
      .from(ClinicModel)
      .where(eq(ClinicModel.userId, userId))
      .limit(1);

    if (!clinic) {
      throw new HttpError(404, 'Clinic not found for this user');
    }

    const [updatedClinic] = await database
      .update(ClinicModel)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(ClinicModel.id, clinic.id))
      .returning();

    // Invalidate clinic cache
    await redisClient.del(`clinic_details:${clinic.id}`);
    await redisClient.del(`user:${userId}`);
    await DashboardService.invalidateDoctorDashboardProfile(clinic.id);

    return {
      onboardingStatus: updatedClinic.onboardingStatus,
      approvalRequestSent: updatedClinic.approvalRequestSent,
      currentStep: updatedClinic.currentStep,
    };
  }

  /**
   * Submit clinic for approval
   * @param userId - The user ID (clinic owner)
   */
  static async submitForApproval(userId: string) {
    // Find the clinic for this user
    const [clinic] = await database
      .select()
      .from(ClinicModel)
      .where(eq(ClinicModel.userId, userId))
      .limit(1);

    if (!clinic) {
      throw new HttpError(404, 'Clinic not found for this user');
    }

    if (clinic.approvalRequestSent) {
      throw new HttpError(400, 'Approval request already submitted');
    }

    if (clinic.onboardingStatus !== 'COMPLETED') {
      throw new HttpError(
        400,
        'Please complete all onboarding steps before submitting for approval'
      );
    }

    const [updatedClinic] = await database
      .update(ClinicModel)
      .set({
        approvalRequestSent: true,
        // awaiting Super Admin review (also covers resubmission after rejection)
        status: 'Pending',
        updatedAt: new Date(),
      })
      .where(eq(ClinicModel.id, clinic.id))
      .returning();

    // Also update user status to Pending
    await database
      .update(UserModel)
      .set({
        userStatus: 'Pending',
        updatedAt: new Date(),
      })
      .where(eq(UserModel.id, userId));

    // Invalidate caches
    await redisClient.del(`clinic_details:${clinic.id}`);
    await redisClient.del(`user:${userId}`);
    await redisClient.del(`user_clinic:${userId}`);

    // TODO: Notify admins about new approval request
    logger.info(`Clinic ${clinic.id} submitted for approval by user ${userId}`);

    return {
      onboardingStatus: updatedClinic.onboardingStatus,
      approvalRequestSent: updatedClinic.approvalRequestSent,
      currentStep: updatedClinic.currentStep,
    };
  }

  // Username format is validated and normalized (lowercased/trimmed) at the
  // schema layer (updateUsernameSchema / checkUsernameSchema).
  static async checkUsernameAvailability(
    userId: string,
    requestedUsername: string
  ): Promise<{ available: boolean; message: string }> {
    const existingUser = await database
      .select({ userName: UserModel.userName })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (existingUser[0]?.userName === requestedUsername) {
      return {
        available: false,
        message: 'This is already your current username',
      };
    }

    const usernameTaken = await database
      .select({ userName: UserModel.userName })
      .from(UserModel)
      .where(
        and(
          eq(UserModel.userName, requestedUsername),
          sql`${UserModel.id} != ${userId}`
        )
      )
      .limit(1);

    if (usernameTaken.length > 0) {
      return {
        available: false,
        message: 'Username is already taken. Please choose another one.',
      };
    }

    return {
      available: true,
      message: 'Username is available',
    };
  }

  static async updateUsername(
    userId: string,
    requestedUsername: string
  ): Promise<{ success: boolean; message: string; username?: string }> {
    try {
      const { available, message } = await this.checkUsernameAvailability(
        userId,
        requestedUsername
      );

      if (!available) {
        return { success: false, message };
      }

      await database
        .update(UserModel)
        .set({
          userName: requestedUsername,
          updatedAt: new Date(),
        })
        .where(eq(UserModel.id, userId));

      return {
        success: true,
        message: 'Username updated successfully',
        username: requestedUsername,
      };
    } catch (error: any) {
      // Handle unique constraint violation
      if (error.code === '23505' || error.code === 'ER_DUP_ENTRY') {
        return {
          success: false,
          message: 'Username is already taken. Please choose another one.',
        };
      }

      return {
        success: false,
        message: 'Failed to update username. Please try again.',
      };
    }
  }

  static async archive(userId: string) {
    const [existingUser] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!existingUser) {
      throw new Error('User not found');
    }

    const newArchiveStatus = !existingUser.isArchive;

    const [updatedUser] = await database
      .update(UserModel)
      .set({
        isArchive: newArchiveStatus,
        updatedAt: new Date(),
      })
      .where(eq(UserModel.id, userId))
      .returning();

    // Invalidate user auth cache so the middleware picks up the new isArchive status
    await redisClient.del(`user:${userId}`);

    try {
      const clinics = await database
        .select({ clinicId: ClinicAssignModel.clinicId })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.userId, userId));
      for (const c of clinics) {
        await UserService.invalidateUsersListCache(c.clinicId);
        await UserService.invalidateDoctorListCache(c.clinicId);
        if (existingUser.userType === 'Patient') {
          await UserService.invalidatePatientListCache(c.clinicId);
        }
      }
    } catch (err) {
      logger.error(
        '[Cache] Failed to invalidate users list cache on archive toggle',
        err
      );
    }

    return updatedUser;
  }

  static async clinicService(payload: {
    patientId: string;
    doctorId: string;
    date?: string; // Format: YYYY-MM-DD (default: today)
  }) {
    return await database.transaction(async (tx) => {
      const today = payload.date ? new Date(payload.date) : new Date();
      today.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // 1. Fetch all active services for the doctor
      const services = await tx
        .select({
          id: ClinicServiceModel.id,
          serviceName: ClinicServiceModel.serviceName,
          price: ClinicServiceModel.price,
          durationDays: ClinicServiceModel.durationDays,
          canBeBookedByPatient: ClinicServiceModel.canBeBookedByPatient,
          isDeleted: ClinicServiceModel.isDeleted,
          createdAt: ClinicServiceModel.createdAt,
          updatedAt: ClinicServiceModel.updatedAt,
        })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.doctorId, payload.doctorId),
            eq(ClinicServiceModel.isDeleted, false)
          )
        )
        .orderBy(asc(ClinicServiceModel.serviceName));

      if (!services.length) {
        return [];
      }

      // 2. Fetch the last PAID appointment for each service
      const serviceIds = services.map((s) => s.id);

      const lastPaidAppointments = await tx
        .select({
          clinicServiceId: AppointmentModel.clinicServiceId,
          lastAppointmentDate:
            sql<Date>`MAX(${AppointmentModel.appointmentDate})`.as(
              'last_appointment_date'
            ),
          paymentMode: AppointmentPaymentModel.paymentMode,
        })
        .from(AppointmentModel)
        .innerJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.patientId, payload.patientId),
            eq(AppointmentModel.doctorId, payload.doctorId),
            inArray(AppointmentModel.clinicServiceId, serviceIds),
            inArray(AppointmentModel.appointmentStatus, [
              'Completed',
              'Confirmed',
              'Pending',
            ]),
            isNotNull(AppointmentPaymentModel.paymentMode),
            sql`${AppointmentPaymentModel.paymentStatus} IS DISTINCT FROM 'Refunded'`
          )
        )
        .groupBy(
          AppointmentModel.clinicServiceId,
          AppointmentPaymentModel.paymentMode
        );

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      endDate.setHours(23, 59, 59, 999);

      // ✅ Check if patient has today's appointment
      const todayAppointments = await tx
        .select({
          id: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.patientId, payload.patientId),
            eq(AppointmentModel.doctorId, payload.doctorId),
            gte(AppointmentModel.appointmentDate, today),
            lte(AppointmentModel.appointmentDate, endDate),
            inArray(AppointmentModel.appointmentStatus, [
              'Completed',
              'Confirmed',
              'Pending',
            ])
          )
        );
      const hasAppointmentToday = todayAppointments.map(
        (appt) => appt.appointmentDate
      );

      // Create a map for quick lookup
      const lastAppointmentMap: Record<string, Date> = {};
      lastPaidAppointments.forEach((apt) => {
        if (apt.clinicServiceId && apt.paymentMode) {
          lastAppointmentMap[apt.clinicServiceId] = apt.lastAppointmentDate;
        }
      });
      // 3. Calculate "Expiring on" date for each service
      const servicesWithExpiry = services.map((service) => {
        const lastPaidAppointmentDate = service.id
          ? lastAppointmentMap[service.id]
          : undefined;

        // Prepare base response
        const baseResponse: any = {
          id: service.id,
          serviceName: service.serviceName,
          price: service.price,
          canBeBookedByPatient: service.canBeBookedByPatient,
          // duration: service.durationDays || 0,
        };

        // If no PAID appointment exists
        if (!lastPaidAppointmentDate) {
          // Don't add "Expiring on" field
          return baseResponse;
        }

        // Calculate expiry date from last PAID appointment
        const lastDate = new Date(lastPaidAppointmentDate);
        const serviceDuration = service.durationDays || 0;

        // Add service duration days to last paid appointment date
        const expiryDate = new Date(lastDate);
        expiryDate.setDate(lastDate.getDate() + serviceDuration);

        // Check if service has expired (expiry date is in the past)
        if (expiryDate < today) {
          // Service has expired - don't show expiry date
          return baseResponse;
        }

        // Format expiry date
        const formattedExpiry = expiryDate.toISOString().split('T')[0];

        return {
          ...baseResponse,
          'Expiring on': formattedExpiry,
        };
      });

      return {
        hasAppointmentToday,
        services: servicesWithExpiry,
      };
    });
  }

  static async getAllUser(clinicId: string, query: getAllPetientsDto) {
    const sortedQueryString = Object.keys(query)
      .sort()
      .map((k) => `${k}:${(query as any)[k]}`)
      .join('|');
    const queryHash = crypto
      .createHash('md5')
      .update(sortedQueryString)
      .digest('hex');
    const cacheKey = `users:list:${clinicId}:${queryHash}`;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[Cache] Redis read error for users list', err);
    }

    const result = await database.transaction(async (tx) => {
      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);
      const conditions: SQL[] = [eq(ClinicAssignModel.clinicId, clinicId)];
      if (query.searchBy) {
        const raw = String(query.searchBy).trim();
        if (raw.length > 0) {
          // split into terms, max 5 terms to avoid heavy queries
          const terms = raw.split(/\s+/).slice(0, 5);

          const termConditions = terms
            .map((term) => {
              const escaped = this.escapeLike(term);
              const pattern = `%${escaped}%`.toLowerCase();

              // Case-insensitive matching using lower(...) LIKE <param>
              // Using sql prevents depending on DB-specific ILIKE
              const byName = sql`lower(${UserModel.name}) LIKE ${pattern}`;
              const byEmail = sql`lower(${UserModel.email}) LIKE ${pattern}`;
              const byMobile = sql`lower(${UserModel.mobile}) LIKE ${pattern}`;
              const byAltMobile = sql`lower(${UserProfileModel.alternateMobile}) LIKE ${pattern}`;

              return or(byName, byEmail, byMobile, byAltMobile);
            })
            .filter((c): c is SQL => c !== undefined);

          // require all terms to match (each term can match any field)
          if (termConditions.length === 1) {
            conditions.push(termConditions[0]);
          } else if (termConditions.length > 1) {
            const andCondition = and(...termConditions);
            if (andCondition) {
              conditions.push(andCondition);
            }
          }
        }
      }
      if (query?.userStatus) {
        conditions.push(eq(UserModel.userStatus, query.userStatus));
      }

      // if (query?.userType) {
      //   conditions.push(eq(UserModel.userType, query.userType));
      // }

      if (query?.userType === 'Doctor') {
        const doctorCondition = or(
          eq(UserModel.userType, 'Doctor'),
          eq(UserModel.isAdminDoctorAccess, true)
        );

        if (doctorCondition) {
          conditions.push(doctorCondition);
        }
      } else if (query?.userType) {
        conditions.push(eq(UserModel.userType, query.userType));
      }

      // Subquery for last appointment (only if userType=Patient)
      const lastAppointmentSubquery = tx
        .select({
          patientId: AppointmentModel.patientId,
          lastVisit: sql<Date>`MAX(${AppointmentModel.appointmentDate})`.as(
            'last_visit'
          ),
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            // Only consider completed appointments for last visit
            eq(AppointmentModel.appointmentStatus, 'Completed')
          )
        )
        .groupBy(AppointmentModel.patientId)
        .as('last_appointment_sq');

      // Subquery for latest no-show action (only if userType=Patient)
      const latestNoShowActionSq = tx
        .select({
          patientId: AppointmentNoShowActionModel.patientId,
          actionTaken: AppointmentNoShowActionModel.actionTaken,
          reason: AppointmentNoShowActionModel.reason,
          createdAt: AppointmentNoShowActionModel.createdAt,
          rowNumber:
            sql<number>`row_number() over (partition by ${AppointmentNoShowActionModel.patientId} order by ${AppointmentNoShowActionModel.createdAt} desc)`.as(
              'rn'
            ),
        })
        .from(AppointmentNoShowActionModel)
        .where(eq(AppointmentNoShowActionModel.clinicId, clinicId))
        .as('latest_noshow_action_sq');

      const noShowActionFinalSq = tx
        .select({
          patientId: latestNoShowActionSq.patientId,
          actionTaken: latestNoShowActionSq.actionTaken,
          reason: latestNoShowActionSq.reason,
          createdAt: latestNoShowActionSq.createdAt,
        })
        .from(latestNoShowActionSq)
        .where(eq(latestNoShowActionSq.rowNumber, 1))
        .as('noshow_final_sq');

      // Subquery for no-show count (only if userType=Patient)
      const noShowCountSq = tx
        .select({
          patientId: AppointmentModel.patientId,
          count: sql<number>`count(*)::int`.as('no_show_count'),
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.appointmentStatus, 'NoShow')
          )
        )
        .groupBy(AppointmentModel.patientId)
        .as('no_show_count_sq');

      // For patient-specific search
      if (query?.patientId) {
        conditions.push(eq(UserModel.id, query.patientId));
      }

      const totalRecords = await tx
        .select({ count: sql`COUNT(DISTINCT ${ClinicAssignModel.id})` })
        .from(ClinicAssignModel)
        .leftJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(and(...conditions));

      const totalCount = Number(totalRecords[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      const serviceCountSq = tx
        .select({
          doctorId: ClinicServiceModel.doctorId,
          count: sql<number>`count(*)::int`.as('service_count'),
        })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.clinicId, clinicId),
            eq(ClinicServiceModel.isDeleted, false)
          )
        )
        .groupBy(ClinicServiceModel.doctorId)
        .as('service_count_sq');

      // Patient-only profile fields — irrelevant for Doctor/Receptionist/
      // Pharmacist/Lab_Assistant/Admin listings, so skip sending them to
      // trim the response payload for the common (non-patient) list views.
      const isPatientQuery = query?.userType === 'Patient';

      const allUser = await tx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: isPatientQuery
            ? UserProfileModel.gender
            : sql<string | null>`NULL`,
          age: isPatientQuery ? UserProfileModel.age : sql<number | null>`NULL`,
          dob: isPatientQuery ? UserProfileModel.dob : sql<Date | null>`NULL`,
          userType: UserModel.userType,
          speciality: UserProfessionalModel.speciality,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          alternateMobile: isPatientQuery
            ? UserProfileModel.alternateMobile
            : sql<string | null>`NULL`,
          address: isPatientQuery
            ? UserProfileModel.address
            : sql<string | null>`NULL`,
          city: isPatientQuery
            ? UserProfileModel.city
            : sql<string | null>`NULL`,
          state: isPatientQuery
            ? UserProfileModel.state
            : sql<string | null>`NULL`,
          zipCode: isPatientQuery
            ? UserProfileModel.zipCode
            : sql<string | null>`NULL`,
          profileImage: UserProfileModel.profileImage,
          upiIds: isPatientQuery
            ? UserProfileModel.upiIds
            : sql<string | null>`NULL`,
          status: UserModel.userStatus,
          isUserBlocked: UserModel.isUserBlocked,
          onlineBookingEnabled: ClinicAssignModel.onlineBookingEnabled,
          serviceCount: sql<number>`COALESCE(${serviceCountSq.count}, 0)`,
          lastVisit:
            query?.userType === 'Patient'
              ? sql<Date | null>`${lastAppointmentSubquery.lastVisit}`
              : sql<Date | null>`NULL`,
          noShowStatus:
            query?.userType === 'Patient'
              ? sql<string | null>`${noShowActionFinalSq.actionTaken}`
              : sql<string | null>`NULL`,
          noShowReason:
            query?.userType === 'Patient'
              ? sql<string | null>`${noShowActionFinalSq.reason}`
              : sql<string | null>`NULL`,
          noShowCount:
            query?.userType === 'Patient'
              ? sql<number>`COALESCE(${noShowCountSq.count}, 0)`
              : sql<number>`0`,
        })
        .from(ClinicAssignModel)
        .leftJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .leftJoin(serviceCountSq, eq(UserModel.id, serviceCountSq.doctorId))
        .leftJoin(
          lastAppointmentSubquery,
          query?.userType === 'Patient'
            ? eq(UserModel.id, lastAppointmentSubquery.patientId)
            : sql`FALSE`
        )
        .leftJoin(
          noShowActionFinalSq,
          query?.userType === 'Patient'
            ? eq(UserModel.id, noShowActionFinalSq.patientId)
            : sql`FALSE`
        )
        .leftJoin(
          noShowCountSq,
          query?.userType === 'Patient'
            ? eq(UserModel.id, noShowCountSq.patientId)
            : sql`FALSE`
        )
        .where(and(...conditions))
        .orderBy(desc(UserModel.createdAt))
        .limit(limit)
        .offset(offset);
      return {
        allUser: allUser,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });

    try {
      await redisClient.setex(cacheKey, 60, JSON.stringify(result));
    } catch (err) {
      logger.warn('[Cache] Redis write error for users list', err);
    }

    return result;
  }

  static async getDoctorList(
    clinicId: string,
    allowedDoctorIds: string[] | null = null
  ) {
    const cacheKey = CacheKeys.clinicDoctorList(
      clinicId,
      scopeCacheKey(allowedDoctorIds)
    );
    const scopeFilter = doctorScopeFilter(UserModel.id, allowedDoctorIds);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn('[Cache] Redis read error for doctor list', err);
    }

    const doctorCondition = or(
      eq(UserModel.userType, 'Doctor'),
      eq(UserModel.isAdminDoctorAccess, true)
    );

    const doctors = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        status: UserModel.userStatus,
        speciality: UserProfessionalModel.speciality,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
      })
      .from(ClinicAssignModel)
      .leftJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          doctorCondition,
          ...(scopeFilter ? [scopeFilter] : [])
        )
      )
      .orderBy(desc(UserModel.createdAt));

    try {
      await redisClient.setex(cacheKey, 60, JSON.stringify(doctors));
    } catch (err) {
      logger.warn('[Cache] Redis write error for doctor list', err);
    }

    return doctors;
  }

  static async invalidateDoctorListCache(clinicId: string) {
    await invalidateCacheByPattern(CacheKeys.clinicDoctorListPattern(clinicId));
  }

  static async invalidateUsersListCache(clinicId: string) {
    try {
      const keys = await redisClient.keys(`users:list:${clinicId}:*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {
      logger.error('[Cache] Failed to invalidate users list cache', err);
    }
  }

  static async referrals(query: GetAllReferralsDto) {
    return await database.transaction(async (tx) => {
      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);
      const conditions: SQL[] = [];

      // Search conditions
      if (query.searchBy) {
        const searchTerm = `%${query.searchBy.toLowerCase()}%`;
        conditions.push(sql`
          (LOWER(${ReferralModel.referralCode}) LIKE ${searchTerm} OR
          LOWER(${ReferralModel.comments}) LIKE ${searchTerm} OR
          LOWER(referred_by_user.name) LIKE ${searchTerm} OR
          LOWER(referred_to_user.name) LIKE ${searchTerm} OR
          LOWER(referred_by_user.email) LIKE ${searchTerm} OR
          LOWER(referred_to_user.email) LIKE ${searchTerm} OR
          LOWER(referred_by_user.mobile) LIKE ${searchTerm} OR
          LOWER(referred_to_user.mobile) LIKE ${searchTerm})
        `);
      }

      // Filters
      if (query.status) conditions.push(eq(ReferralModel.status, query.status));
      if (query.referredByName)
        conditions.push(
          sql`LOWER(referred_by_user.name) LIKE ${`%${query.referredByName.toLowerCase()}%`}`
        );
      if (query.referredToName)
        conditions.push(
          sql`LOWER(referred_to_user.name) LIKE ${`%${query.referredToName.toLowerCase()}%`}`
        );

      // Date range
      if (query.fromDate && query.toDate) {
        conditions.push(
          between(
            ReferralModel.createdAt,
            new Date(query.fromDate),
            new Date(query.toDate)
          )
        );
      } else if (query.fromDate) {
        // gte/lte, not a raw sql`` template: the column helpers run the Date
        // through the timestamp column's driver mapper. Interpolating a Date
        // into sql`` skips it and postgres-js rejects the param with
        // ERR_INVALID_ARG_TYPE.
        conditions.push(gte(ReferralModel.createdAt, new Date(query.fromDate)));
      } else if (query.toDate) {
        conditions.push(lte(ReferralModel.createdAt, new Date(query.toDate)));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [totalResult] = await tx.execute(sql`
        SELECT COUNT(*) as count
        FROM referrals
        LEFT JOIN users AS referred_by_user ON referrals.referred_by = referred_by_user.id
        LEFT JOIN users AS referred_to_user ON referrals.referred_to = referred_to_user.id
        ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      `);

      const totalCount = Number((totalResult as any)?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      // Get paginated results with flat structure
      const referralsResult = await tx.execute(sql`
        SELECT 
          referrals.id,
          referrals.referral_code,
          referrals.status,
          referrals.comments,
          referrals.created_at,
          referrals.updated_at,
          referred_by_user.id as referred_by_id,
          referred_by_user.name as referred_by_name,
          referred_by_user.email as referred_by_email,
          referred_by_user.mobile as referred_by_mobile,
          referred_by_user.user_type as referred_by_user_type,
          referred_to_user.id as referred_to_id,
          referred_to_user.name as referred_to_name,
          referred_to_user.email as referred_to_email,
          referred_to_user.mobile as referred_to_mobile,
          referred_to_user.user_type as referred_to_user_type
        FROM referrals
        LEFT JOIN users AS referred_by_user ON referrals.referred_by = referred_by_user.id
        LEFT JOIN users AS referred_to_user ON referrals.referred_to = referred_to_user.id
        ${whereClause ? sql`WHERE ${whereClause}` : sql``}
        ORDER BY referrals.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      // Transform to nested structure
      const referrals = (referralsResult as any[]).map((row: any) => ({
        id: row.id,
        referralCode: row.referral_code,
        status: row.status,
        comments: row.comments,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        referredBy: row.referred_by_id
          ? {
              id: row.referred_by_id,
              name: row.referred_by_name,
              email: row.referred_by_email,
              mobile: row.referred_by_mobile,
              userType: row.referred_by_user_type,
            }
          : null,
        referredTo: row.referred_to_id
          ? {
              id: row.referred_to_id,
              name: row.referred_to_name,
              email: row.referred_to_email,
              mobile: row.referred_to_mobile,
              userType: row.referred_to_user_type,
            }
          : null,
      }));

      // Get stats
      const [stats] = await tx
        .select({
          totalReferrals: sql<number>`COUNT(*)::int`,
          pendingReferrals: sql<number>`SUM(CASE WHEN ${ReferralModel.status} = 'pending' THEN 1 ELSE 0 END)::int`,
          approvedReferrals: sql<number>`SUM(CASE WHEN ${ReferralModel.status} = 'approved' THEN 1 ELSE 0 END)::int`,
          rejectedReferrals: sql<number>`SUM(CASE WHEN ${ReferralModel.status} = 'rejected' THEN 1 ELSE 0 END)::int`,
        })
        .from(ReferralModel);

      return {
        referrals,
        stats,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }

  static async searchPatient(clinicId: string, query: SearchPatientDto) {
    const { search, pageSize: ps, pageNumber: pn } = query;
    const pageSize = Math.max(Number(ps) || 30, 1);
    const pageNumber = Math.max(Number(pn) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: SQL[] = [
      eq(UserModel.userType, 'Patient'),
      eq(ClinicAssignModel.clinicId, clinicId),
    ];

    if (search && search.trim()) {
      const pattern = `%${this.escapeLike(search.trim())}%`.toLowerCase();
      const searchCondition = or(
        sql`lower(${UserModel.name}) LIKE ${pattern}`,
        sql`lower(${UserModel.mobile}) LIKE ${pattern}`
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    // Only fetch primary patients (those with a mobile, i.e. not family dependents)
    // plus family dependents who directly match the search.
    const results = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        mobile: UserModel.mobile,
        gender: UserProfileModel.gender,
        age: UserProfileModel.age,
        city: UserProfileModel.city,
        state: UserProfileModel.state,
      })
      .from(UserModel)
      .innerJoin(ClinicAssignModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(UserModel.createdAt));

    const familyMembersMap = await this.getFamilyMembersMap(
      results.map((r) => r.id)
    );

    const data = results.map((patient) => ({
      ...patient,
      familyMembers: familyMembersMap[patient.id] || [],
    }));

    const totalRecordsResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(UserModel)
      .innerJoin(ClinicAssignModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(and(...conditions));

    const totalCount = Number(totalRecordsResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      data,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  /**
   * GET /api/v1/patient/check-mobile
   * Checks whether a Patient with the given 10-digit mobile exists.
   * Returns { exists: true, patient } if found, { exists: false } otherwise.
   * Used by the receptionist before creating a family link.
   */
  static async checkPatientByMobile(mobile: string) {
    const [patient] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        mobile: UserModel.mobile,
        gender: UserProfileModel.gender,
        age: UserProfileModel.age,
        city: UserProfileModel.city,
        state: UserProfileModel.state,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(
        and(eq(UserModel.mobile, mobile), eq(UserModel.userType, 'Patient'))
      )
      .limit(1);

    if (!patient) {
      return { exists: false };
    }

    const familyMap = await this.getFamilyMembersMap([patient.id]);
    return {
      exists: true,
      patient: { ...patient, familyMembers: familyMap[patient.id] || [] },
    };
  }

  /** Family of each patient both ways: linked members, plus their primary as 'primary'. */
  private static async getFamilyMembersMap(patientIds: string[]) {
    const familyMembersMap: Record<
      string,
      Array<{
        id: string;
        name: string | null;
        relationship: string;
        gender: string | null;
        age: number | null;
      }>
    > = {};

    if (patientIds.length > 0) {
      // Family members where matched patient is the PRIMARY
      const asPrimary = await database
        .select({
          primaryPatientId: PatientFamilyLinksModel.primaryPatientId,
          id: UserModel.id,
          name: UserModel.name,
          relationship: PatientFamilyLinksModel.relationship,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
        )
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(inArray(PatientFamilyLinksModel.primaryPatientId, patientIds));

      // Family info where matched patient is the LINKED member (show their primary)
      const asLinked = await database
        .select({
          linkedPatientId: PatientFamilyLinksModel.linkedPatientId,
          id: UserModel.id,
          name: UserModel.name,
          relationship: PatientFamilyLinksModel.relationship,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
        )
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(inArray(PatientFamilyLinksModel.linkedPatientId, patientIds));

      for (const row of asPrimary) {
        const key = row.primaryPatientId;
        if (!familyMembersMap[key]) familyMembersMap[key] = [];
        familyMembersMap[key].push({
          id: row.id,
          name: row.name,
          relationship: row.relationship,
          gender: row.gender,
          age: row.age,
        });
      }

      for (const row of asLinked) {
        const key = row.linkedPatientId;
        if (!familyMembersMap[key]) familyMembersMap[key] = [];
        familyMembersMap[key].push({
          id: row.id,
          name: row.name,
          relationship: 'primary',
          gender: row.gender,
          age: row.age,
        });
      }
    }
    return familyMembersMap;
  }
}
