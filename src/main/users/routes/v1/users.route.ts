import { Router } from 'express';
import {
  addUserController,
  resendInviteController,
  getAllUserController,
  getDoctorListController,
  getUserController,
  loginController,
  socialLoginController,
  registerController,
  refreshTokenController,
  logoutController,
  requestPasswordResetController,
  resetPasswordController,
  sendVerificationController,
  updateAdminPermissionToDoctorController,
  verifyEmailController,
  UpdateUserController,
  requestRegistrationVerificationController,
  verifyRegistrationOTPController,
  checkRegistrationTokenController,
  checkInviteTokenController,
  changePasswordController,
  getChangePasswordVisibilityController,
  generateReferralCodeController,
  GetDoctorServiceController,
  togglePaymentHistory,
  updateUserStatusController,
  archiveController,
  referralsController,
  updateReferralController,
  updateOnboardingProgressController,
  submitForApprovalController,
  verifySubscriptionController,
  getClinicDashboardOverviewController,
  getClinicDashboardActivitiesController,
  getClinicDashboardStatsController,
  updateUsernameController,
  checkUsernameController,
  activateDoctorController,
} from '../../controllers/user.controller';
import {
  addUserSchema,
  resendInviteSchema,
  getAllPetientsSchema,
  loginSchema,
  socialLoginSchema,
  registerSchema,
  refreshTokenSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateAdminPermissionToDoctorSchema,
  verifyEmailSchema,
  updateUserSchema,
  requestRegistrationSchema,
  verifyOtpSchema,
  checkRegistrationTokenSchema,
  checkRegistrationTokenQuerySchema,
  checkInviteTokenSchema,
  checkInviteTokenQuerySchema,
  setInitialPasswordSchema,
  changePasswordSchema,
  GetDoctorServiceSchema,
  updateUserStatusSchema,
  referralsSchema,
  updateReferralSchema,
  updateOnboardingProgressSchema,
  updateUsernameSchema,
  checkUsernameSchema,
} from '../../schemas/auth.schemas';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  enforceClinicAutoLogout,
  requireAdmin,
  requireAuth,
  requireClinic,
  requireDoctor,
  requireReceptionist,
  requireRole,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { getStaffDirectoryController } from '../../controllers/staffDirectory.controller';
import { staffDirectoryQuerySchema } from '../../schemas/staffDirectory.schema';
import { requireTurnstile } from '../../../../middlewear/turnstile.middleware';
import { requireAddUserLimit } from '../../../../middlewear/limitation.middleware';
import {
  strictRateLimit,
  otpRateLimit,
} from '../../../../middlewear/rateLimit.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { UserService } from '../../services/user.service';
import { asyncHandler } from '../../../../middlewear/errorHandler';

// create user router instance
const userRouter = Router();

/**
 * @route POST /api/v1/users/request-registration
 * @desc Request registration verification email
 * @access Public
 */
userRouter.post(
  '/request-registration',
  otpRateLimit,
  validate(requestRegistrationSchema, 'body'),
  requestRegistrationVerificationController
);

/**
 * @route POST /api/v1/users/verify-otp
 * @desc Verify registration OTP
 * @access Public
 */
userRouter.post(
  '/verify-otp',
  otpRateLimit,
  validate(verifyOtpSchema, 'body'),
  verifyRegistrationOTPController
);

/**
 * @route GET /api/v1/users/verify-registration-token/:token
 * @desc Verify registration token validity
 * @access Public
 */
userRouter.get(
  '/verify-registration-token/:token',
  validate(checkRegistrationTokenSchema, 'params'),
  validate(checkRegistrationTokenQuerySchema, 'query'),
  checkRegistrationTokenController
);

/**
 * @route GET /api/v1/users/verify-invite-token/:token
 * @desc Verify invitation token validity
 * @access Public
 */
userRouter.get(
  '/verify-invite-token/:token',
  validate(checkInviteTokenSchema, 'params'),
  validate(checkInviteTokenQuerySchema, 'query'),
  checkInviteTokenController
);

/**
 * @route POST /api/v1/users/register
 * @desc Register a new user
 * @access Public
 */
userRouter.post(
  '/register',
  strictRateLimit,
  requireTurnstile(true), // Always require for registration
  validate(registerSchema, 'body'),
  registerController
);

/**
 * @route POST /api/v1/users/login
 * @desc Authenticate user and return token
 * @access Public
 */
userRouter.post(
  '/login',
  strictRateLimit,
  requireTurnstile(false), // Conditional based on failed attempts
  validate(loginSchema, 'body'),
  loginController
);

/**
 * @route POST /api/v1/users/social-login
 * @desc Authenticate with a social identity provider and return token
 * @access Public
 */
userRouter.post(
  '/social-login',
  strictRateLimit,
  validate(socialLoginSchema, 'body'),
  socialLoginController
);

/**
 * @route POST /api/v1/users/refresh-token
 * @desc Exchange a valid refresh token for a new access/refresh token pair
 * @access Public
 */
userRouter.post(
  '/refresh-token',
  validate(refreshTokenSchema, 'body'),
  refreshTokenController
);

/**
 * @route POST /api/v1/users/logout
 * @desc Revoke a refresh token, ending that session
 * @access Public
 */
userRouter.post(
  '/logout',
  validate(refreshTokenSchema, 'body'),
  logoutController
);

userRouter.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema, 'body'),
  changePasswordController
);

userRouter.get(
  '/change-password-visibility',
  requireAuth,
  getChangePasswordVisibilityController
);

userRouter.get(
  '/generate-referral-code',
  requireAuth,
  generateReferralCodeController
);

userRouter.patch(
  '/update-referral-status/:referralId',
  requireAuth,
  requireSuperAdmin,
  validate(updateReferralSchema, 'body'),
  updateReferralController
);

/**
 * @route POST /api/v1/users/send-verification
 * @desc Send email verification link to current user
 * @access Private
 */
userRouter.post('/send-verification', requireAuth, sendVerificationController);

/**
 * @route GET /api/v1/users/verify-email/:token
 * @desc Verify user email using token
 * @access Public
 */
userRouter.get(
  '/verify-email/:token',
  validate(verifyEmailSchema, 'params'),
  verifyEmailController
);

/**
 * @route POST /api/v1/users/request-password-reset
 * @desc Send password reset link to user's email
 * @access Public
 */
userRouter.post(
  '/request-password-reset',
  strictRateLimit,
  requireTurnstile(false), // Conditional based on failed attempts
  validate(requestPasswordResetSchema, 'body'),
  requestPasswordResetController
);

/**
 * @route POST /api/v1/users/reset-password
 * @desc Reset user password using token from email
 * @access Public
 */
userRouter.post(
  '/reset-password',
  strictRateLimit,
  requireTurnstile(false), // Conditional based on failed attempts
  validate(resetPasswordSchema, 'body'),
  resetPasswordController
);

/**
 * @route GET /api/v1/users/
 * @desc Get details of the currently logged-in user
 * @access Private
 */
userRouter.get(
  '/',
  requireAuth,
  // requireReceptionist,
  // requireClinic,
  getUserController
);

/**
 * @route POST /api/v1/users/verify-subscription
 * @desc Take the one-time subscription
 * @access Private
 */
userRouter.post(
  '/verify-subscription',
  requireAuth,
  requireClinic,
  verifySubscriptionController
);

/**
 * @route POST /api/v1/users/adduser
 * @desc Add a new user (Doctor/Receptionist) to a clinic
 * @access Private (Admin, Clinic)
 */
userRouter.post(
  '/adduser',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(addUserSchema, 'body'),
  requireAddUserLimit,
  addUserController
);

userRouter.post(
  '/resend-invite',
  requireAuth,
  requireAdmin,
  requireClinic,
  strictRateLimit,
  validate(resendInviteSchema, 'body'),
  resendInviteController
);

userRouter.post(
  '/update-payment-history',
  requireAuth,
  requireDoctor,
  togglePaymentHistory
);

userRouter.post(
  '/set-initial-password',
  validate(setInitialPasswordSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { token, password, name } = req.validatedBody;
    const result = await UserService.setInitialPassword(token, password, name);
    res.json(result);
  })
);

/**
 * @route PUT /api/v1/users/update-admin-permission-to-doctor
 * @desc Grant or revoke admin permissions for a doctor
 * @access Private (Admin, Clinic)
 */
userRouter.put(
  '/update-admin-permission-to-doctor',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(updateAdminPermissionToDoctorSchema, 'body'),
  updateAdminPermissionToDoctorController
);

/**
 * @route PUT /api/v1/users/UpdateAdduser/:userId
 * @desc Update details of a user added to the clinic
 * @access Private (Admin, Clinic)
 */
userRouter.patch(
  '/:userId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(updateUserSchema, 'body'),
  UpdateUserController
);

userRouter.patch(
  '/status-change/:userId',
  requireAuth,
  requireSuperAdmin,
  validate(updateUserStatusSchema, 'body'),
  updateUserStatusController
);

userRouter.post(
  '/archive/:userId',
  requireAuth,
  requireSuperAdmin,
  archiveController
);

/**
 * @route POST /api/v1/users/activate-doctor
 * @desc Self-service: a Doctor whose status is Pending activates their own account
 * @access Private (Doctor)
 */
userRouter.post('/activate-doctor', requireAuth, activateDoctorController);

userRouter.get(
  '/get-service/:patientId/:doctorId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(GetDoctorServiceSchema, 'params'),
  GetDoctorServiceController
);

/**
 * @route GET /api/v1/users/get-all-user
 * @desc Get all users associated with the clinic
 * @access Private (Receptionist, Clinic)
 */
userRouter.get(
  '/get-all-user',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAllPetientsSchema, 'query'),
  enforceClinicAutoLogout,
  getAllUserController
);

/**
 * @route GET /api/v1/users/staff-directory
 * @desc  Users & Roles list for one staff role, with the filter options that
 *        role supports. Separate from /users so each role's list carries only
 *        its own columns.
 * @access Private (Admin)
 */
userRouter.get(
  '/staff-directory',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(staffDirectoryQuerySchema, 'query'),
  enforceClinicAutoLogout,
  getStaffDirectoryController
);

/**
 * @route GET /api/v1/users/doctor-list
 * @desc Get a lightweight list of clinic doctors (id, name, status, serviceCount) for dropdowns
 * @access Private (Receptionist, Clinic)
 */
userRouter.get(
  '/doctor-list',
  requireAuth,
  requireReceptionist,
  requireClinic,
  enforceClinicAutoLogout,
  getDoctorListController
);

userRouter.get(
  '/lab-pharmacy/overview',
  requireAuth,
  requireClinic,
  getClinicDashboardOverviewController
);

userRouter.get(
  '/lab-pharmacy/activities-users',
  requireAuth,
  requireClinic,
  getClinicDashboardActivitiesController
);

userRouter.get(
  '/lab-pharmacy/stats',
  requireAuth,
  requireClinic,
  getClinicDashboardStatsController
);

userRouter.get(
  '/get-all-referrals',
  requireAuth,
  requireSuperAdmin,
  validate(referralsSchema, 'query'),
  referralsController
);

/**
 * @route PUT /api/v1/users/onboarding/progress
 * @desc Update user onboarding progress
 * @access Private
 */
userRouter.put(
  '/onboarding/progress',
  requireAuth,
  validate(updateOnboardingProgressSchema, 'body'),
  updateOnboardingProgressController
);

/**
 * @route POST /api/v1/users/onboarding/submit
 * @desc Submit user profile for approval
 * @access Private
 */
userRouter.post('/onboarding/submit', requireAuth, submitForApprovalController);

/**
 * @route POST /api/v1/users/check-username
 * @desc Validate a username and check availability without updating it
 * @access Private
 */
userRouter.post(
  '/check-username',
  requireAuth,
  validate(checkUsernameSchema, 'body'),
  checkUsernameController
);

userRouter.put(
  '/update-username',
  requireAuth,
  validate(updateUsernameSchema, 'body'),
  updateUsernameController
);

export default userRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/request-registration',
  description: 'Request registration verification OTP',
  requestSchema: requestRegistrationSchema,
  tags: ['users', 'register'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/verify-otp',
  description: 'Verify registration OTP and get session token',
  requestSchema: verifyOtpSchema,
  tags: ['users', 'register'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/register', // full path as it would appear in the app
  description: 'Create a new user',
  requestSchema: registerSchema,
  tags: ['users', 'register'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/login', // full path as it would appear in the app
  description: 'we can login',
  requestSchema: loginSchema,
  tags: ['users', 'login'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/social-login',
  description: 'login with a social identity provider',
  requestSchema: socialLoginSchema,
  tags: ['users', 'login'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/refresh-token',
  description: 'Exchange a valid refresh token for a new token pair',
  requestSchema: refreshTokenSchema,
  tags: ['users', 'login'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/logout',
  description: 'Revoke a refresh token',
  requestSchema: refreshTokenSchema,
  tags: ['users', 'login'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/users', // full path as it would appear in the app
  description: 'we can get current login user',
  tags: ['users', 'current user'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/send-verification', // full path as it would appear in the app
  description: 'we can send verification email',
  requestSchema: registerSchema,
  tags: ['users', 'email verification'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/users/verify-email/:token', // full path as it would appear in the app
  description: 'we can verufy email',
  params: verifyEmailSchema,
  tags: ['users', 'email verification'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/request-password-reset', // full path as it would appear in the app
  description: 'we can send request for reset password',
  requestSchema: requestPasswordResetSchema,
  tags: ['users', 'reset password'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/reset-password', // full path as it would appear in the app
  description: 'we can reset password',
  requestSchema: resetPasswordSchema,
  tags: ['users', 'reset password'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/adduser', // full path as it would appear in the app
  description: 'we can reset password',
  requestSchema: addUserSchema,
  tags: ['users', 'adduser'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/resend-invite', // full path as it would appear in the app
  description:
    'resend the set-password invite email to a user who has not accepted yet',
  requestSchema: resendInviteSchema,
  tags: ['users', 'adduser'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/users/get-all-user', // full path as it would appear in the app
  description: 'get all user',
  query: getAllPetientsSchema,
  tags: ['users', 'get all user'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/users/update-admin-permission-to-doctor',
  description: 'we can update admin permission to doctor',
  requestSchema: updateAdminPermissionToDoctorSchema,
  tags: ['users', 'update admin permission to doctor'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/users/onboarding/progress',
  description: 'Update user onboarding progress',
  requestSchema: updateOnboardingProgressSchema,
  tags: ['users', 'onboarding'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/onboarding/submit',
  description: 'Submit user profile for approval',
  tags: ['users', 'onboarding'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/check-username',
  description: 'Validate a username and check availability without updating it',
  requestSchema: checkUsernameSchema,
  tags: ['users', 'username'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/users/activate-doctor',
  description:
    'Self-service: the logged-in Doctor activates their own Pending account',
  tags: ['users', 'doctor', 'status'],
});
