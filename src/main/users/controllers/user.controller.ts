// src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import { ClinicDashboardOverviewService } from '../services/dashboardOverview.service';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { DoctorServices } from '../../doctor/services/doctor.service';
import { doctorRutineDufet } from '../../../utils/avaliblity';
import { LabService } from '../../lab/services/lab.service';
import {
  trackFailedAttempt,
  resetFailedAttempts,
} from '../../../utils/security';
import logger from '../../../utils/logger';
import { sendOk } from '../../../utils/response.utils';
import redisClient from '../../../configurations/redisConfig';
import { ReferralService } from '../../../utils/referralEncodeDecode';
import { ReferralModel } from '../models/referral.model';
import { UserModel } from '../models/user.model';
import { PermissionService } from '../../permissions/services/permission.service';
import { StaffAssignmentService } from '../../permissions/services/staffAssignment.service';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { database } from '../../../configurations/dbConnection';
import { desc, eq, sql } from 'drizzle-orm';
import {
  SubscriptionPlanModel,
  ClinicSubscriptionModel,
} from '../../subscription/models/subscription.model';
import { SubscriptionService } from '../../subscription/services/subscription.service';
import { sendNoContent } from '../../../utils/response.utils';
import { TokenService } from '../services/token.service';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { notifyClinicAdminsOfStaffAction } from '../../../utils/notificationHelpers';

export const requestRegistrationVerificationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.validatedBody;
    const result = await UserService.requestRegistrationVerification(email);
    res.json({ success: true, ...result });
  }
);

export const verifyRegistrationOTPController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, otp } = req.validatedBody;
    const result = await UserService.verifyRegistrationOTP(email, otp);
    res.json({ success: true, ...result });
  }
);

export const checkRegistrationTokenController = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.validatedParams;
    const { email } = req.validatedQuery || {};
    const result = await UserService.checkRegistrationToken(token, email);
    return sendOk(res, 'Token is valid', result);
  }
);

export const checkInviteTokenController = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.validatedParams;
    const { email, userId } = req.validatedQuery || {};
    const result = await UserService.checkInviteToken(token, email, userId);
    return sendOk(res, 'Token is valid', result);
  }
);

export const registerController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const result = await UserService.register(payload);

    if (payload.referralCode) {
      try {
        const referrerId = ReferralService.decodeReferralCode(
          payload.referralCode
        );

        if (typeof referrerId === 'string' && referrerId.length > 0) {
          const [referrer] = await database
            .select({ id: UserModel.id })
            .from(UserModel)
            .where(sql`${UserModel.id} = ${referrerId}`)
            .limit(1);

          if (referrer) {
            await database.insert(ReferralModel).values({
              referredTo: result.user.id,
              referredBy: referrerId,
              referralCode: payload.referralCode,
            });
          }
        }
      } catch {
        console.error('Referral record failed');
      }
    }

    res.status(201).json({
      success: true,
      ...result,
      token: result.accessToken,
    });
  }
);

export const loginController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, password } = req.validatedBody;
    // const clientIp = req.ip || req.socket.remoteAddress;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const ipKey = `failed_attempts:ip:${clientIp}`;
    const emailKey = `failed_attempts:email:${email}`;

    const userAgent = req.headers['user-agent'];

    try {
      const result = await UserService.login(
        email,
        password,
        clientIp,
        userAgent
      );

      // If MFA is required, return the temporary token and indicator
      if ('mfaRequired' in result) {
        // Success: Reset failed attempts even for MFA flow (primary auth passed)
        await Promise.all([
          resetFailedAttempts(ipKey),
          resetFailedAttempts(emailKey),
        ]);

        res.json({
          success: true,
          mfaRequired: true,
          tempToken: result.tempToken,
        });
        return;
      }

      const { user, accessToken, refreshToken } = result;

      // Success: Reset failed attempts
      await Promise.all([
        resetFailedAttempts(ipKey),
        resetFailedAttempts(emailKey),
      ]);

      res.json({
        success: true,
        user,
        token: accessToken,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        // Track failed attempt by IP and Email
        const [ipAttempts, emailAttempts] = await Promise.all([
          trackFailedAttempt(ipKey),
          trackFailedAttempt(emailKey),
        ]);

        logger.warn(
          `Failed login attempt for ${email} from ${clientIp}. IP attempts: ${ipAttempts}, Email attempts: ${emailAttempts}`
        );

        // Return generic error message to avoid bot hints as per instructions
        // throw new HttpError(401, 'Invalid email or password.');
      }
      throw error;
    }
  }
);

export const socialLoginController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    const device = (req.query.device as string) || payload.device || 'web';

    const { user, accessToken, refreshToken } = await UserService.socialLogin(
      payload,
      clientIp,
      userAgent,
      device as 'web' | 'ios' | 'android'
    );

    res.json({
      success: true,
      user,
      token: accessToken,
      accessToken,
      refreshToken,
    });
  }
);

/**
 * POST /api/v1/users/refresh-token
 * Exchanges a valid (unrevoked, non-reused) refresh token for a new
 * access/refresh token pair. Rotates the refresh token on every call.
 */
export const refreshTokenController = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.validatedBody;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket.remoteAddress;

    const tokens = await TokenService.rotateRefreshToken(refreshToken, {
      userAgent,
      ipAddress,
    });

    return sendOk(res, 'Token refreshed successfully', {
      ...tokens,
      token: tokens.accessToken,
    });
  }
);

/**
 * POST /api/v1/users/logout
 * Revokes the given refresh token so it can no longer be used to mint new
 * access tokens. The current access token remains valid until it expires
 * (stateless), but no further refresh is possible for this session.
 */
export const logoutController = asyncHandler(
  async (req: Request, res: Response) => {
    const { refreshToken } = req.validatedBody;
    await TokenService.revokeToken(refreshToken);
    return sendNoContent(res, 'Logged out successfully');
  }
);

export const changePasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    const { password, newPassword } = req.validatedBody;
    const userId = req.user?.id;

    if (!userId) throw new HttpError(401, 'Authentication required');

    const authHeader =
      req.headers['authorization'] || req.headers['Authorization'];
    let currentToken: string | undefined;
    if (authHeader) {
      const parts = String(authHeader).split(' ');
      if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
        currentToken = parts[1];
      }
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];

    const tokens = await UserService.changePassword(
      userId,
      password,
      newPassword,
      {
        currentToken,
        ipAddress: clientIp,
        userAgent,
      }
    );

    // Notify Clinic Admin if a staff member or doctor changed their password
    const staffRoles = [
      'Doctor',
      'Receptionist',
      'Lab_Assistant',
      'Pharmacist',
      'Nurse',
      'Radiologist',
    ];
    if (staffRoles.includes(req.user?.userType)) {
      try {
        const [assign] = await database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, userId))
          .limit(1);

        if (assign) {
          const [staffUser] = await database
            .select({ name: UserModel.name })
            .from(UserModel)
            .where(eq(UserModel.id, userId))
            .limit(1);

          const userRoleName =
            req.user?.userType === 'Doctor'
              ? 'Doctor'
              : `Staff member (${req.user?.userType})`;
          await notifyClinicAdminsOfStaffAction({
            clinicId: assign.clinicId,
            title: 'Staff Security Modification',
            eventKey: 'staff.security_modified',
            body: `${userRoleName} ${staffUser?.name || 'Unknown'} changed their password.`,
            action: 'user_created',
          });
        }
      } catch (err) {
        logger.error(
          '[Notification] Error sending staff/doctor password change alert to clinic admin:',
          err
        );
      }
    }

    res.json({
      success: true,
      message: 'Password changed successfully',
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }
);

export const getChangePasswordVisibilityController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;

    if (!userId) throw new HttpError(401, 'Authentication required');

    const [user] = await database
      .select({
        password: UserModel.password,
        socialProvider: UserModel.socialProvider,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) throw new HttpError(404, 'User not found');

    const shouldHideCurrentPassword =
      !user.password && Boolean(user.socialProvider);

    res.json({
      success: true,
      currentPassword: shouldHideCurrentPassword ? 'hide' : 'show',
    });
  }
);

export const generateReferralCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new HttpError(401, 'Authentication required');

      const referralCode = ReferralService.generateReferralCode(userId);
      const referralLink = `${process.env.FRONTEND_URL}/signup-email?rfc=${referralCode}`;

      const userReferrals = await database
        .select({
          id: ReferralModel.id,
          referredTo: ReferralModel.referredTo,
          referredToName: sql<string>`COALESCE(${UserModel.name}, 'Unknown User')`,
          referredBy: ReferralModel.referredBy,
          referralCode: ReferralModel.referralCode,
          status: ReferralModel.status,
          comments: ReferralModel.comments,
          createdAt: ReferralModel.createdAt,
          updatedAt: ReferralModel.updatedAt,
        })
        .from(ReferralModel)
        .orderBy(desc(ReferralModel.createdAt))
        .leftJoin(UserModel, eq(ReferralModel.referredTo, UserModel.id))
        .where(eq(ReferralModel.referredBy, userId));

      const totalReferrals = userReferrals.length;
      const approvedReferrals = userReferrals.filter(
        (r: any) => r.status === 'approved'
      ).length;
      const pendingReferrals = userReferrals.filter(
        (r: any) => r.status === 'pending'
      ).length;
      const rejectedReferrals = userReferrals.filter(
        (r: any) => r.status === 'rejected'
      ).length;

      res.json({
        success: true,
        referralCode,
        referralLink,
        totalReferrals,
        approvedReferrals,
        pendingReferrals,
        rejectedReferrals,
        allData: userReferrals,
      });
    } catch {
      throw new HttpError(500, 'Failed to generate referral code');
    }
  }
);

export const updateReferralController = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const referralId = req.params.referralId as string;
      const { status, comments } = req.body;

      if (!referralId) {
        throw new HttpError(400, 'Referral ID is required');
      }

      const result = await UserService.updateReferralStatus(referralId, {
        status,
        comments,
      });

      res.json({
        success: true,
        message: result.message,
        data: result.referral,
      });
    } catch {
      throw new HttpError(500, 'Failed to update referral');
    }
  }
);

export const sendVerificationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { user } = req;
    const userId = user.id; // if you have auth middleware
    const result = await UserService.sendEmailVerification(userId);
    res.json({ success: true, ...result });
  }
);

export const verifyEmailController = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.validatedParams;
    const result = await UserService.verifyEmail(token);
    res.json({ success: true, ...result });
  }
);

export const requestPasswordResetController = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.validatedBody;
    const clientIp = req.ip || req.socket.remoteAddress;
    const ipKey = `failed_attempts:ip:${clientIp}`;
    const emailKey = `failed_attempts:email:${email}`;

    try {
      const result = await UserService.requestPasswordReset(email);
      res.json({ success: true, ...result });
    } catch (error) {
      // Track attempts even if it fails (e.g., user not found or rate limited)
      await Promise.all([
        trackFailedAttempt(ipKey),
        trackFailedAttempt(emailKey),
      ]);
      throw error;
    }
  }
);

export const resetPasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    const { token, newPassword } = req.validatedBody;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];

    const result = await UserService.resetPassword(token, newPassword, {
      ipAddress: clientIp,
      userAgent,
    });

    const user = result.user;
    const staffRoles = [
      'Doctor',
      'Receptionist',
      'Lab_Assistant',
      'Pharmacist',
      'Nurse',
      'Radiologist',
    ];
    if (user && staffRoles.includes(user.userType)) {
      try {
        const [assign] = await database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, user.id))
          .limit(1);

        if (assign) {
          const userRoleName =
            user.userType === 'Doctor'
              ? 'Doctor'
              : `Staff member (${user.userType})`;
          await notifyClinicAdminsOfStaffAction({
            clinicId: assign.clinicId,
            title: 'Staff Security Modification',
            eventKey: 'staff.security_modified',
            body: `${userRoleName} ${user.name || 'Unknown'} changed their password.`,
            action: 'user_created',
          });
        }
      } catch (err) {
        logger.error(
          '[Notification] Error sending reset password alert to clinic admin:',
          err
        );
      }
    }

    res.json({
      success: true,
      message: result.message,
      user: result.user,
      token: result.accessToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  }
);
export const getUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user;
    // const clinicId = req.clinicId;

    const userId = (user as { id: string }).id;

    const result = await UserService.getUser(userId);

    // if (!result) throw new HttpError(404, 'User not found');

    res.json({ success: true, ...result });
  }
);

export const createCreatePetientController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const clinicId = req.clinicId;
    const result = await UserService.createPatient(payload, clinicId);
    res.json({ success: true, result });
  }
);

export const updatePetientController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const result = await UserService.updatePatient(payload);
    res.json({ success: true, result });
  }
);

export const getPetientController = asyncHandler(
  async (req: Request, res: Response) => {
    const petientId = req.validatedParams.peteintId;
    const includeFamilyDetails = req.validatedQuery?.familyDetails === 'true';
    const result = await UserService.getPeteintById(
      petientId,
      includeFamilyDetails
    );
    if (!result) throw new HttpError(404, 'User not found');
    res.json({ success: true, result });
  }
);

export const getAllPetientController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;
    const user = req.user;
    const result = await UserService.getAllPeteints(clinicId, query, user);
    // if (!result) throw new HttpError(404, 'User not found');
    res.json({ success: true, result });
  }
);

export const addUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const clinicId = req.clinicId;

    const result = await UserService.addUser(clinicId, payload);

    // Invalidate overview cache when any staff or doctor is added
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    // Lab_Assistant: assign to the specified lab
    if (payload.userType === 'Lab_Assistant') {
      await LabService.updateLabUser(result.id, clinicId, payload.labId);
    }

    // Pharmacist: assign to the specified pharmacy
    if (payload.userType === 'Pharmacist' && payload.pharmacyId) {
      const { PharmacyService } =
        await import('../../pharmacy/services/pharmacy.service');
      await PharmacyService.assignUserToPharmacy(
        payload.pharmacyId,
        result.id,
        clinicId,
        'Pharmacist'
      );
    }

    // Applied here rather than by follow-up calls from the client: a user
    // created but left without the permissions the admin just chose is a
    // half-configured account nobody is told about.
    if (payload.permissionKeys?.length) {
      await PermissionService.updateUserPermissions({
        userId: result.id,
        clinicId,
        permissionKeys: payload.permissionKeys,
        performedBy: req.user.id,
      });
    }

    if (payload.assignment) {
      await StaffAssignmentService.updateAssignment({
        userId: result.id,
        clinicId,
        performedBy: req.user.id,
        payload: payload.assignment,
      });
    }

    res.json({
      success: true,
      message: "Sent to user's on email verification successfully",
      result,
    });
  }
);

export const resendInviteController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.validatedBody;
    const clinicId = req.clinicId;

    const result = await UserService.resendInvite(clinicId, userId);

    sendOk(res, 'Invite email resent successfully', result);
  }
);

export const togglePaymentHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    // Fetch user data using the same pattern as registerController
    const [user] = await database
      .select({
        id: UserModel.id,
        userType: UserModel.userType,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        paymentVisible: UserModel.paymentVisible,
      })
      .from(UserModel)
      .where(sql`${UserModel.id} = ${userId}`)
      .limit(1);

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const hasAccess =
      user.isAdminDoctorAccess === true || user.userType === 'Doctor';
    if (!hasAccess) {
      throw new HttpError(400, 'Insufficient Role');
    }

    const [updatedUser] = await database
      .update(UserModel)
      .set({
        paymentVisible: sql`NOT ${UserModel.paymentVisible}`,
      })
      .where(sql`${UserModel.id} = ${userId}`)
      .returning({
        userId: UserModel.id,
        paymentVisible: UserModel.paymentVisible,
      });

    res.status(200).json({
      success: true,
      message: 'Payment history visibility updated',
      data: updatedUser,
    });
  }
);

export const UpdateUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const userId = req.params.userId as string;
    const clinicId = req.clinicId;

    // Fetch user details before update to compare email/mobile modifications
    let targetUser = null;
    try {
      [targetUser] = await database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          userType: UserModel.userType,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);
    } catch (err) {
      logger.error(
        '[Notification] Failed to query user before profile update:',
        err
      );
    }

    const user = await UserService.updateUser(
      userId,
      clinicId,
      payload,
      req.user?.id
    );

    // Invalidate limits cache when user is updated (userType may change)
    if (clinicId) {
      await redisClient.del(`clinic_limits_overview:${clinicId}`);
    }

    // Notify Clinic Admin if a staff member's or doctor's email or mobile was updated
    if (
      targetUser &&
      [
        'Doctor',
        'Receptionist',
        'Lab_Assistant',
        'Pharmacist',
        'Nurse',
        'Radiologist',
      ].includes(targetUser.userType)
    ) {
      const emailChanged = payload.email && payload.email !== targetUser.email;
      const mobileChanged =
        payload.mobile && payload.mobile !== targetUser.mobile;
      if (emailChanged || mobileChanged) {
        try {
          let targetClinicId = clinicId;
          if (!targetClinicId) {
            const [assign] = await database
              .select({ clinicId: ClinicAssignModel.clinicId })
              .from(ClinicAssignModel)
              .where(eq(ClinicAssignModel.userId, targetUser.id))
              .limit(1);
            targetClinicId = assign?.clinicId;
          }

          if (targetClinicId) {
            let changeDesc = '';
            if (emailChanged && mobileChanged) {
              changeDesc = `email (to ${payload.email}) and mobile number (to ${payload.mobile})`;
            } else if (emailChanged) {
              changeDesc = `email (to ${payload.email})`;
            } else {
              changeDesc = `mobile number (to ${payload.mobile})`;
            }

            const userRoleName =
              targetUser.userType === 'Doctor'
                ? 'Doctor'
                : `staff member (${targetUser.userType})`;
            await notifyClinicAdminsOfStaffAction({
              clinicId: targetClinicId,
              title: 'Staff Profile Updated',
              eventKey: 'staff.profile_updated',
              body: `Profile details of ${userRoleName} ${targetUser.name || 'Unknown'} have been modified: ${changeDesc}.`,
              action: 'user_created',
            });
          }
        } catch (err) {
          logger.error(
            '[Notification] Error sending staff/doctor profile change alert to clinic admin:',
            err
          );
        }
      }
    }

    res.status(200).json({
      message: 'User updated successfully',
      data: user,
    });
  }
);

export const updateUserStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const payload = req.validatedBody;
    const clinicId = req.clinicId;

    const user = await UserService.updateUserStatus(userId as string, payload, {
      performedByUserId: req.user?.id,
    });

    // Invalidate limits cache when user status changes (Active/Inactive affects counts)
    if (clinicId) {
      await redisClient.del(`clinic_limits_overview:${clinicId}`);
    }

    // Notify Clinic Admin when a staff member's or doctor's account status changes
    if (
      user &&
      [
        'Doctor',
        'Receptionist',
        'Lab_Assistant',
        'Pharmacist',
        'Nurse',
        'Radiologist',
      ].includes(user.userType)
    ) {
      try {
        let targetClinicId = clinicId;
        if (!targetClinicId) {
          const [assign] = await database
            .select({ clinicId: ClinicAssignModel.clinicId })
            .from(ClinicAssignModel)
            .where(eq(ClinicAssignModel.userId, user.id))
            .limit(1);
          targetClinicId = assign?.clinicId;
        }

        if (targetClinicId) {
          const userRoleName =
            user.userType === 'Doctor'
              ? 'Doctor'
              : `staff member (${user.userType})`;
          await notifyClinicAdminsOfStaffAction({
            clinicId: targetClinicId,
            title: 'Staff Status Changed',
            eventKey: 'staff.status_changed',
            body: `Status of ${userRoleName} ${user.name || 'Unknown'} has been changed to ${payload.userStatus}.`,
            action: 'user_created',
          });
        }
      } catch (err) {
        logger.error(
          '[Notification] Error sending staff/doctor status change alert to clinic admin:',
          err
        );
      }
    }

    res.status(200).json({
      success: true,
      message: 'User status updated successfully',
      data: user,
    });
  }
);

export const activateDoctorController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    const result = await UserService.activateDoctor(userId);

    sendOk(res, result.message ?? 'Doctor activated successfully', result);
  }
);

export const archiveController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const clinicId = req.clinicId;

    const user = await UserService.archive(userId as string);

    // Invalidate limits cache when user is archived/unarchived
    if (clinicId) {
      await redisClient.del(`clinic_limits_overview:${clinicId}`);
    }

    const action = user.isArchive ? 'archived' : 'unarchived';
    const message = `User ${action} successfully`;

    res.status(200).json({
      success: true,
      message: message,
    });
  }
);

export const GetDoctorServiceController = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.params.patientId as string;
    const doctorId = req.params.doctorId as string;

    const services = await UserService.clinicService({
      patientId,
      doctorId,
      date: new Date().toISOString().split('T')[0],
    });

    res.status(200).json({
      message: 'Services fetched successfully',
      data: services,
    });
  }
);

export const updateAdminPermissionToDoctorController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const clinicId = req.clinicId;
    const userId = req.user.id;

    const result = await UserService.updateAdminPermissionToDoctor(
      userId,
      payload
    );
    if (result[0].isAdminDoctorAccess) {
      await DoctorServices.updateUser(userId, clinicId, doctorRutineDufet);
    }

    // Invalidate limits cache — toggling isAdminDoctorAccess affects doctor counts
    if (clinicId) {
      await redisClient.del(`clinic_limits_overview:${clinicId}`);
    }

    res.json({
      success: true,
      message: 'Admin permission updated successfully',
      result,
    });
  }
);

export const getAllUserController = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const clinicId = req.clinicId;
      const query = req.validatedQuery;
      const result = await UserService.getAllUser(clinicId, query);

      res.json({
        success: true,
        message: 'user data fetched successfully',
        result,
      });
    } catch {
      throw new HttpError(500, 'Failed to fetch user data');
    }
  }
);

export const getDoctorListController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    // The booking screen's doctor dropdown reads this. Scoping it here is what
    // makes an out-of-scope doctor unpickable rather than merely hidden.
    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      req.user,
      clinicId
    );
    const result = await UserService.getDoctorList(clinicId, allowedDoctorIds);
    sendOk(res, 'Doctor list fetched successfully', result);
  }
);

export const referralsController = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const query = req.validatedQuery;
      const result = await UserService.referrals(query);

      res.json({
        success: true,
        message: 'Referral data fetched successfully',
        result,
      });
    } catch {
      throw new HttpError(500, 'Failed to fetch referral data');
    }
  }
);

export const searchPatientController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;
    const result = await UserService.searchPatient(clinicId, query);
    return sendOk(res, 'Patients searched successfully', result);
  }
);

export const checkPatientByMobileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile } = req.validatedQuery;
    const result = await UserService.checkPatientByMobile(mobile);
    return sendOk(res, 'Patient lookup successful', result);
  }
);

/**
 * Update user onboarding progress
 * @route PUT /api/v1/users/onboarding/progress
 */
export const updateOnboardingProgressController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const payload = req.validatedBody;
    const result = await UserService.updateOnboardingProgress(userId, payload);

    res.json({
      success: true,
      message: 'Onboarding progress updated successfully',
      data: result,
    });
  }
);

/**
 * Submit user profile for approval
 * @route POST /api/v1/users/onboarding/submit
 */
export const submitForApprovalController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Authentication required');

    const result = await UserService.submitForApproval(userId);

    res.json({
      success: true,
      message: 'Profile submitted for approval successfully',
      data: result,
    });
  }
);

export const checkUsernameController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userName } = req.validatedBody;
    const userId = req.user.id;

    const result = await UserService.checkUsernameAvailability(
      userId,
      userName
    );

    sendOk(res, result.message, {
      available: result.available,
      username: userName,
    });
  }
);

export const updateUsernameController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userName } = req.validatedBody;
    const userId = req.user.id;
    const clinicId = req.clinicId;

    const result = await UserService.updateUsername(userId, userName);

    if (!result.success) {
      throw new HttpError(400, result.message);
    }

    // Invalidate caches
    if (clinicId) {
      await Promise.all([
        redisClient.del(`clinic_limits_overview:${clinicId}`),
        redisClient.del(`user_profile:${userId}`),
        redisClient.del(`doctor_profile:${userId}`),
      ]);
    }

    sendOk(res, 'Username updated successfully', {
      username: result.username,
    });
  }
);

/**
 * Activate the free trial subscription (configured in seeds / DB)
 * @route POST /api/v1/users/verify-subscription
 */
export const verifySubscriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic ID is required');
    }

    // Find the configured trial plan (with fallback to 'CareHub' if not explicitly flagged)
    let [trialPlan] = await database
      .select({
        id: SubscriptionPlanModel.id,
        price: SubscriptionPlanModel.price,
        trialDays: SubscriptionPlanModel.trialDays,
        name: SubscriptionPlanModel.name,
      })
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.isTrialPlan, true))
      .limit(1);

    if (!trialPlan) {
      [trialPlan] = await database
        .select({
          id: SubscriptionPlanModel.id,
          price: SubscriptionPlanModel.price,
          trialDays: SubscriptionPlanModel.trialDays,
          name: SubscriptionPlanModel.name,
        })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.name, 'CareHub'))
        .limit(1);
    }

    if (!trialPlan) {
      throw new HttpError(404, 'Trial subscription plan not found');
    }

    const durationDays = trialPlan.trialDays ?? 30;
    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // Deactivate previous active subscriptions for this clinic
    await database
      .update(ClinicSubscriptionModel)
      .set({ active: false })
      .where(eq(ClinicSubscriptionModel.clinicId, clinicId));

    // Insert new subscription
    const [newSubscription] = await database
      .insert(ClinicSubscriptionModel)
      .values({
        clinicId,
        planId: trialPlan.id,
        startsAt,
        expiresAt,
        active: true,
        price: '0',
        transactionId: 'TRIAL',
        paymentStatus: 'success',
      })
      .returning();

    // Redis cache invalidate for clinic active subscription
    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_details:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    // Call updateUserSubscriptionExpiryCache
    await SubscriptionService.updateUserSubscriptionExpiryCache(
      clinicId,
      expiresAt
    );

    res.json({
      success: true,
      message: `Free trial for ${trialPlan.name} plan activated successfully (${durationDays} days)`,
      data: newSubscription,
    });
  }
);

export const getClinicDashboardOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic ID is required');
    }

    const data = await ClinicDashboardOverviewService.getOverviewData(clinicId);
    sendOk(res, 'Dashboard overview data fetched successfully', data);
  }
);

export const getClinicDashboardActivitiesController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic ID is required');
    }

    const data =
      await ClinicDashboardOverviewService.getClinicDashboardActivities(
        clinicId
      );
    sendOk(res, 'Dashboard activities and users fetched successfully', data);
  }
);

export const getClinicDashboardStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic ID is required');
    }

    const data =
      await ClinicDashboardOverviewService.getClinicDashboardStats(clinicId);
    sendOk(res, 'Dashboard statistics fetched successfully', data);
  }
);
