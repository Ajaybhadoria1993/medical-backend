// src/main/patient/services/patientAuth.service.ts
import { and, eq, lt } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { TokenModel } from '../../users/models/token.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { generateOTP, hashToken } from '../../../utils/authUtils';
import { TokenService } from '../../users/services/token.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A profile is considered complete when the three fields required by the
 * post-login modal have been filled: name, gender, and date of birth.
 * Email is intentionally excluded — it is optional per the data model.
 */
function checkProfileComplete(
  name: string | null | undefined,
  gender: string | null | undefined,
  dob: string | null | undefined
): boolean {
  return Boolean(name?.trim()) && Boolean(gender) && Boolean(dob?.trim());
}
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';
import logger from '../../../utils/logger';
import { loginAlertQueue } from '../../notifications/services/loginAlertQueue.service';
import { envConfig } from '../../../utils/envConfig';

// ─── Constants & Configuration ────────────────────────────────────────────────
const OTP_EXPIRY_MS = envConfig.OTP_EXPIRY_MS;
const OTP_EXPIRY_MINUTES = Math.floor(OTP_EXPIRY_MS / 60000);
const OTP_RESEND_COOLDOWN_SECS = envConfig.OTP_RESEND_COOLDOWN_SECS;
const MAX_RESEND_COUNT = envConfig.OTP_MAX_RESEND_COUNT;
const OTP_RATE_REDIS_PREFIX = envConfig.OTP_RATE_REDIS_PREFIX;
const OTP_RATE_WINDOW_SECS = envConfig.OTP_RATE_WINDOW_SECS;
const MAX_OTP_ATTEMPTS_PER_WINDOW = envConfig.OTP_MAX_ATTEMPTS_PER_WINDOW;
const SESSION_CACHE_TTL_SECS = envConfig.SESSION_CACHE_TTL_SECS;

// Controlled by environment variables (if true, always use fixed OTP and skip SMS sending)
const IS_BYPASS_ENABLED = envConfig.OTP_BYPASS_ENABLED;
const FIXED_OTP = envConfig.OTP_FIXED;
const BYPASS_TEST_MOBILE = envConfig.BYPASS_TEST_MOBILE;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Single helper for OTP bypass (global dev bypass OR test number from BYPASS_TEST_MOBILE).
 */
function isOtpBypass(mobile?: string, otp?: string): boolean {
  const isTargetNumber =
    Boolean(BYPASS_TEST_MOBILE) &&
    Boolean(mobile) &&
    normaliseMobile(mobile as string) ===
      normaliseMobile(BYPASS_TEST_MOBILE as string);
  const bypassApplicable = IS_BYPASS_ENABLED || isTargetNumber;

  if (!bypassApplicable) return false;
  if (otp !== undefined) return otp === FIXED_OTP;
  return true;
}

/**
 * Normalise mobile to 10-digit string (strips leading 91 / +91 / 0).
 */
function normaliseMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits; // already 10 digits
}

/**
 * Format mobile to E.164 for AWS SNS (+91XXXXXXXXXX).
 */
function toE164(mobile: string): string {
  return `+91${normaliseMobile(mobile)}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PatientAuthService {
  /**
   * Step 1 — Send OTP to any mobile number.
   *
   * Stores the OTP in `tokens` table with type='patient_otp'.
   * The `email` column of the tokens row holds the patient's mobile number.
   * If the patient account already exists, it is checked for blocked/archived
   * status before an OTP is generated — avoids wasting SMS credits.
   */
  static async sendOtp(mobile: string) {
    const normalised = normaliseMobile(mobile);
    const bypassMode = isOtpBypass(normalised);

    // 1️⃣ Redis rate limit — max 5 sends per 10-min window per mobile (skipped for bypass)
    if (!bypassMode) {
      const rateKey = `${OTP_RATE_REDIS_PREFIX}:${normalised}`;
      const sendCount = await redisClient.incr(rateKey);
      if (sendCount === 1) {
        await redisClient.expire(rateKey, OTP_RATE_WINDOW_SECS);
      }
      if (sendCount > MAX_OTP_ATTEMPTS_PER_WINDOW) {
        throw new HttpError(
          429,
          'Too many OTP requests. Please try again after 10 minutes.'
        );
      }
    }

    // 2️⃣ Early account-status guard — only for existing patients.
    //    New mobiles pass through freely; account is created in verifyOtp.
    const [existingPatient] = await database
      .select({
        userStatus: UserModel.userStatus,
        isUserBlocked: UserModel.isUserBlocked,
        isArchive: UserModel.isArchive,
      })
      .from(UserModel)
      .where(
        and(eq(UserModel.mobile, normalised), eq(UserModel.userType, 'Patient'))
      )
      .limit(1);

    if (existingPatient) {
      if (existingPatient.isArchive) {
        throw new HttpError(
          403,
          'This account has been archived. Please contact support.'
        );
      }
      if (
        existingPatient.isUserBlocked ||
        existingPatient.userStatus === 'Blocked' ||
        existingPatient.userStatus === 'Inactive'
      ) {
        throw new HttpError(
          403,
          'Your account has been deactivated. Please contact support.'
        );
      }
    }

    // 3️⃣ Delete any existing patient_otp for this mobile (one active OTP at a time)
    // mobile is stored in the `email` column for patient_otp type
    await database
      .delete(TokenModel)
      .where(
        and(
          eq(TokenModel.email, normalised),
          eq(TokenModel.type, 'patient_otp')
        )
      );

    // 4️⃣ Generate & store OTP in tokens table
    const otp = bypassMode ? FIXED_OTP : generateOTP(6);
    const otpHash = hashToken(otp);

    if (bypassMode) {
      logger.info(`[OTP Bypass] OTP for ${normalised}: ${otp}`);
    }

    await database.insert(TokenModel).values({
      // userId is NULL at this stage — patient may not exist yet
      email: normalised, // stores mobile in email column per data model spec
      tokenHash: otpHash,
      type: 'patient_otp',
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      used: false,
      resendCount: 0,
    });

    // 5️⃣ Send SMS via AWS SNS (skipped in development or test bypass).
    //    Awaited so that a delivery failure surfaces as a 502 rather than
    //    silently returning "OTP sent" while the patient receives nothing.
    if (!bypassMode) {
      const smsBody = `INFINITYGENESIS TECHSO PRIVATE LIMITED: Your Infinity MediSetu verification code is ${otp}. It is valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`;
      try {
        await UniversalNotificationService.send({
          recipient: { mobile: toE164(normalised) },
          event: 'patient_mobile_verification',
          channels: ['sms'],
          title: 'Medisetu OTP',
          body: smsBody,
          throwOnError: true,
        });
      } catch (err) {
        logger.error(
          `[PatientAuth] Failed to send OTP SMS to ${normalised}:`,
          err
        );
        // Clean up the stored OTP — it is useless if the patient never received it
        await database
          .delete(TokenModel)
          .where(
            and(
              eq(TokenModel.email, normalised),
              eq(TokenModel.type, 'patient_otp')
            )
          );
        throw new HttpError(
          502,
          'We could not deliver the OTP to your mobile number. Please try again.'
        );
      }
    }

    logger.info(`[PatientAuth] OTP sent to ...${normalised.slice(-4)}`);

    return {
      message: bypassMode
        ? `OTP sent (bypass mode: use ${FIXED_OTP})`
        : 'OTP sent to your mobile number',
      expiresInSeconds: OTP_EXPIRY_MS / 1000,
    };
  }

  /**
   * Step 2 — Verify OTP, then upsert patient.
   *
   * Looks up the token row by mobile (stored in `email` column) + hash.
   * After OTP is validated:
   *  - Patient with this mobile exists → login (existing user).
   *  - No patient found → auto-create user + empty profile → first login.
   *
   * Returns isNewUser=true on first login so the frontend can redirect
   * to the "complete your profile" screen.
   */
  static async verifyOtp(
    mobile: string,
    otp: string,
    ipAddress?: string,
    userAgent?: string,
    platform: 'web' | 'ios' | 'android' = 'web'
  ) {
    const normalised = normaliseMobile(mobile);

    // 1️⃣ Find matching token record (bypassed when isOtpBypass is true)
    if (!isOtpBypass(normalised, otp)) {
      const otpHash = hashToken(otp);

      const [record] = await database
        .select()
        .from(TokenModel)
        .where(
          and(
            eq(TokenModel.email, normalised),
            eq(TokenModel.tokenHash, otpHash),
            eq(TokenModel.type, 'patient_otp')
          )
        )
        .limit(1);

      if (!record) {
        throw new HttpError(400, 'Invalid OTP. Please check and try again.');
      }

      if (new Date(record.expiresAt) < new Date()) {
        await database.delete(TokenModel).where(eq(TokenModel.id, record.id));
        throw new HttpError(400, 'OTP has expired. Please request a new one.');
      }

      // 2️⃣ Delete OTP token immediately — single use
      await database.delete(TokenModel).where(eq(TokenModel.id, record.id));
    } else {
      // Clean up token if present
      await database
        .delete(TokenModel)
        .where(
          and(
            eq(TokenModel.email, normalised),
            eq(TokenModel.type, 'patient_otp')
          )
        );
      logger.info(
        `[PatientAuth] OTP bypass login verified for mobile ...${normalised.slice(-4)}`
      );
    }

    // 3️⃣ Upsert patient — login if exists, auto-create if not
    let isNewUser = false;

    let patient = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        isUserBlocked: UserModel.isUserBlocked,
        isArchive: UserModel.isArchive,
        emailVerifiedAt: UserModel.emailVerifiedAt,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
      })
      .from(UserModel)
      .where(
        and(eq(UserModel.mobile, normalised), eq(UserModel.userType, 'Patient'))
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!patient) {
      // First time — auto-create patient account
      isNewUser = true;

      patient = await database.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(UserModel)
          .values({
            mobile: normalised,
            userType: 'Patient',
            userStatus: 'Active',
            // No fake email — per data model spec, patients store NULL
          })
          .returning({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            mobile: UserModel.mobile,
            userType: UserModel.userType,
            userStatus: UserModel.userStatus,
            isUserBlocked: UserModel.isUserBlocked,
            isArchive: UserModel.isArchive,
            emailVerifiedAt: UserModel.emailVerifiedAt,
            isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
          });

        // Create empty profile row so downstream joins never return null
        await tx.insert(UserProfileModel).values({ userId: newUser.id });

        return newUser;
      });

      logger.info(
        `[PatientAuth] New patient auto-created for mobile ...${normalised.slice(-4)}`
      );
    } else {
      // Existing patient — guard archived, blocked, and inactive accounts
      if (patient.isArchive) {
        throw new HttpError(
          403,
          'This account has been archived. Please contact support.'
        );
      }
      if (
        patient.isUserBlocked ||
        patient.userStatus === 'Blocked' ||
        patient.userStatus === 'Inactive'
      ) {
        throw new HttpError(
          403,
          'Your account has been deactivated. Please contact support.'
        );
      }
    }

    // 4️⃣ Issue access/refresh token pair, scoped to this platform — web and
    // app can each hold their own session without evicting the other.
    const tokens = await TokenService.issueTokenPair(patient.id, {
      ipAddress,
      userAgent,
      platform,
    });

    // 5️⃣ Fetch profile fields needed to compute isProfileComplete.
    //    For a new user this row was just created (empty), so all fields will
    //    be null — isProfileComplete will correctly be false.
    const [profile] = await database
      .select({
        gender: UserProfileModel.gender,
        dob: UserProfileModel.dob,
      })
      .from(UserProfileModel)
      .where(eq(UserProfileModel.userId, patient.id))
      .limit(1);

    const isProfileComplete = checkProfileComplete(
      patient.name,
      profile?.gender,
      profile?.dob
    );

    // 6️⃣ Cache patient in Redis
    await redisClient.setex(
      `user:${patient.id}`,
      SESSION_CACHE_TTL_SECS,
      JSON.stringify(patient)
    );

    // 7️⃣ Clear OTP rate limit on successful login
    await redisClient.del(`${OTP_RATE_REDIS_PREFIX}:${normalised}`);

    // 8️⃣ Queue login alert (non-blocking)
    loginAlertQueue
      .addLoginAlert({
        userId: patient.id,
        userEmail: patient.email ?? '',
        userName: patient.name ?? '',
        loginTime: new Date().toISOString(),
        ipAddress,
        userAgent,
      })
      .catch(() => {
        /* non-critical */
      });

    logger.info(
      `[PatientAuth] Patient ${patient.id} logged in via OTP (new=${isNewUser}, profileComplete=${isProfileComplete})`
    );

    return {
      message: isNewUser
        ? 'Account created and logged in successfully'
        : 'Login successful',
      ...tokens,
      isNewUser,
      // true  → profile is complete, go straight to home / member selection
      // false → show the profile completion modal before anything else
      isProfileComplete,
      user: {
        id: patient.id,
        mobile: patient.mobile,
        userType: patient.userType,
        userStatus: patient.userStatus,
      },
    };
  }

  /**
   * Resend OTP — enforces a per-request cooldown and max resend cap.
   *
   * Finds the active patient_otp token row by mobile (stored in `email` column),
   * checks cooldown and resend cap, then replaces the hash + expiry.
   */
  static async resendOtp(mobile: string) {
    const normalised = normaliseMobile(mobile);
    const bypassMode = isOtpBypass(normalised);

    // 1️⃣ Rate limit check (shared with sendOtp, skipped for bypass numbers)
    if (!bypassMode) {
      const rateKey = `${OTP_RATE_REDIS_PREFIX}:${normalised}`;
      const sendCount = await redisClient.incr(rateKey);
      if (sendCount === 1) {
        await redisClient.expire(rateKey, OTP_RATE_WINDOW_SECS);
      }
      if (sendCount > MAX_OTP_ATTEMPTS_PER_WINDOW) {
        throw new HttpError(
          429,
          'Too many OTP requests. Please try again after 10 minutes.'
        );
      }
    }

    // 2️⃣ Find existing patient_otp token (mobile in email column)
    const [existing] = await database
      .select()
      .from(TokenModel)
      .where(
        and(
          eq(TokenModel.email, normalised),
          eq(TokenModel.type, 'patient_otp')
        )
      )
      .limit(1);

    if (!existing && !bypassMode) {
      throw new HttpError(
        400,
        'No active OTP session found. Please request a new OTP.'
      );
    }

    // 3️⃣ Enforce resend count cap (skipped in bypass mode)
    if (!bypassMode && existing && existing.resendCount >= MAX_RESEND_COUNT) {
      throw new HttpError(
        429,
        'Maximum resend limit reached. Please wait 10 minutes before requesting a new OTP.'
      );
    }

    // 4️⃣ Enforce 1-minute cooldown between resends (skipped in bypass mode)
    if (!bypassMode && existing) {
      const lastSentAt = existing.updatedAt ?? existing.createdAt;
      const secondsSinceLast =
        (Date.now() - new Date(lastSentAt).getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECS) {
        const waitSeconds = Math.ceil(
          OTP_RESEND_COOLDOWN_SECS - secondsSinceLast
        );
        throw new HttpError(
          429,
          `Please wait ${waitSeconds} seconds before requesting another OTP.`
        );
      }
    }

    // 5️⃣ Generate fresh OTP and update or insert the token row
    const newOtp = bypassMode ? FIXED_OTP : generateOTP(6);
    const newOtpHash = hashToken(newOtp);

    if (bypassMode) {
      logger.info(`[OTP Bypass] Resent OTP for ${normalised}: ${newOtp}`);
    }

    const newExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    if (existing) {
      await database
        .update(TokenModel)
        .set({
          tokenHash: newOtpHash,
          expiresAt: newExpiresAt,
          resendCount: existing.resendCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(TokenModel.id, existing.id));
    } else {
      await database.insert(TokenModel).values({
        email: normalised,
        tokenHash: newOtpHash,
        type: 'patient_otp',
        expiresAt: newExpiresAt,
        used: false,
        resendCount: 1,
      });
    }

    // 6️⃣ Send SMS via AWS SNS (skipped in bypass mode).
    //    Awaited so delivery failures surface as a 502 rather than
    //    silently returning "OTP resent" while the patient receives nothing.
    if (!bypassMode) {
      const smsBody = `INFINITYGENESIS TECHSO PRIVATE LIMITED: Your Infinity MediSetu verification code is ${newOtp}. It is valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`;
      try {
        await UniversalNotificationService.send({
          recipient: { mobile: toE164(normalised) },
          event: 'patient_mobile_verification_resend',
          channels: ['sms'],
          title: 'Medisetu OTP',
          body: smsBody,
          throwOnError: true,
        });
      } catch (err) {
        logger.error(
          `[PatientAuth] Failed to resend OTP SMS to ${normalised}:`,
          err
        );
        // Roll back the resend count increment so the patient can try again
        if (existing) {
          await database
            .update(TokenModel)
            .set({
              tokenHash: existing.tokenHash,
              expiresAt: existing.expiresAt,
              resendCount: existing.resendCount,
              updatedAt: existing.updatedAt,
            })
            .where(eq(TokenModel.id, existing.id));
        }
        throw new HttpError(
          502,
          'We could not deliver the OTP to your mobile number. Please try again.'
        );
      }
    }

    logger.info(
      `[PatientAuth] OTP resent to mobile ending in ...${normalised.slice(-4)}`
    );

    return {
      message: bypassMode
        ? `OTP resent (bypass mode: use ${FIXED_OTP})`
        : 'OTP resent successfully',
      expiresInSeconds: OTP_EXPIRY_MS / 1000,
      resendCount: existing ? existing.resendCount + 1 : 1,
    };
  }

  /**
   * Logout — invalidates the Redis session cache for the patient.
   * The JWT itself remains valid until expiry (stateless), but the cached
   * user record is cleared so the next requireAuth re-fetches from DB.
   */
  static async logout(userId: string) {
    await redisClient.del(`user:${userId}`);
    logger.info(`[PatientAuth] Patient ${userId} logged out`);
    return { message: 'Logged out successfully' };
  }

  /**
   * Cleanup utility — removes all expired patient_otp token rows.
   * Call from a cron job or scheduled task.
   */
  static async cleanupExpiredOtps() {
    const deleted = await database
      .delete(TokenModel)
      .where(
        and(
          lt(TokenModel.expiresAt, new Date()),
          eq(TokenModel.type, 'patient_otp')
        )
      );
    logger.info('[PatientAuth] Cleaned up expired patient OTP token records');
    return deleted;
  }
}
