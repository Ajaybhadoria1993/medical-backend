// src/main/patient/routes/v1/patientAuth.route.ts
import { Router } from 'express';
import {
  sendOtpController,
  verifyOtpController,
  resendOtpController,
  logoutController,
} from '../../controllers/patientAuth.controller';
import {
  sendMobileOtpSchema,
  verifyMobileOtpSchema,
  resendMobileOtpSchema,
} from '../../schemas/patient.schemas';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requirePatient,
} from '../../../../middlewear/auth.middleware';
import {
  otpRateLimit,
  strictRateLimit,
} from '../../../../middlewear/rateLimit.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';

const patientAuthRouter = Router();

/**
 * @route  POST /api/v1/patient/patient-auth/send-otp
 * @desc   Send a 6-digit OTP to the patient's registered mobile number
 * @access Public
 */
patientAuthRouter.post(
  '/send-otp',
  otpRateLimit,
  validate(sendMobileOtpSchema, 'body'),
  sendOtpController
);

/**
 * @route  POST /api/v1/patient/patient-auth/verify-otp
 * @desc   Verify OTP and receive a JWT session token
 * @access Public
 */
patientAuthRouter.post(
  '/verify-otp',
  strictRateLimit,
  validate(verifyMobileOtpSchema, 'body'),
  verifyOtpController
);

/**
 * @route  POST /api/v1/patient/patient-auth/resend-otp
 * @desc   Resend a fresh OTP (1-min cooldown, max 5 resends per session)
 * @access Public
 */
patientAuthRouter.post(
  '/resend-otp',
  otpRateLimit,
  validate(resendMobileOtpSchema, 'body'),
  resendOtpController
);

/**
 * @route  POST /api/v1/patient/patient-auth/logout
 * @desc   Invalidate the current patient session
 * @access Private — Patient only
 */
patientAuthRouter.post(
  '/logout',
  requireAuth,
  requirePatient,
  logoutController
);

export default patientAuthRouter;

// ─── API Docs ─────────────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/patient-auth/send-otp',
  description: 'Send OTP to patient mobile number',
  requestSchema: sendMobileOtpSchema,
  tags: ['patient-auth'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/patient-auth/verify-otp',
  description: 'Verify OTP and get JWT session token',
  requestSchema: verifyMobileOtpSchema,
  tags: ['patient-auth'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/patient-auth/resend-otp',
  description: 'Resend OTP to patient mobile',
  requestSchema: resendMobileOtpSchema,
  tags: ['patient-auth'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/patient-auth/logout',
  description: 'Logout patient and invalidate session',
  tags: ['patient-auth'],
});
