// src/main/patient/controllers/patientAuth.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PatientAuthService } from '../services/patientAuth.service';

/**
 * POST /api/v1/patient/send-otp
 * Send a 6-digit OTP to the patient's registered mobile number.
 * Public — no auth required.
 */
export const sendOtpController = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile } = req.validatedBody;
    const result = await PatientAuthService.sendOtp(mobile);
    return sendOk(res, result.message, {
      expiresInSeconds: result.expiresInSeconds,
    });
  }
);

/**
 * POST /api/v1/patient/verify-otp
 * Verify the OTP and issue a JWT session token.
 * Public — no auth required.
 */
export const verifyOtpController = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile, otp, platform } = req.validatedBody;
    const ipAddress = req.ip ?? req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await PatientAuthService.verifyOtp(
      mobile,
      otp,
      ipAddress,
      userAgent,
      platform
    );

    return sendOk(res, result.message, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      isNewUser: result.isNewUser,
      user: result.user,
    });
  }
);

/**
 * POST /api/v1/patient/resend-otp
 * Resend a fresh OTP to the patient's mobile (1-min cooldown, max 5 resends).
 * Public — no auth required.
 */
export const resendOtpController = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile } = req.validatedBody;
    const result = await PatientAuthService.resendOtp(mobile);
    return sendOk(res, result.message, {
      expiresInSeconds: result.expiresInSeconds,
      resendCount: result.resendCount,
    });
  }
);

/**
 * POST /api/v1/patient/logout
 * Invalidate the patient's Redis session cache.
 * Private — requires a valid JWT (requireAuth).
 */
export const logoutController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await PatientAuthService.logout(userId);
    return sendOk(res, result.message);
  }
);
