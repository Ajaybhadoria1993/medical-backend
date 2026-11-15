import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import {
  sendCreated,
  sendNoContent,
  sendOk,
} from '../../../utils/response.utils';
import { generateOTP } from '../services/otp.service';
import {
  BRIDGE_TTL_SECONDS,
  cancelBridgeSession,
  createUniqueBridgeSession,
  getBridgeSession,
  getRemainingSessionTtlSeconds,
  updateBridgeSession,
} from '../services/scan.bridge.service';
import {
  scanBridgeOtpQuerySchema,
  scanBridgeUploadSchema,
} from '../validators/scan.bridge.validator';

const parseOtp = (req: Request) => {
  const parsed = scanBridgeOtpQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'Invalid OTP');
  return parsed.data.otp;
};

export const createScanSession = asyncHandler(
  async (_req: Request, res: Response) => {
    const session = await createUniqueBridgeSession(generateOTP, 5);
    if (!session) {
      throw new HttpError(503, 'Could not create scan session. Please retry.');
    }
    return sendCreated(res, 'Scan session created', {
      otp: session.otp,
      expiresIn: BRIDGE_TTL_SECONDS,
    });
  }
);

export const uploadScanViaOtp = asyncHandler(
  async (req: Request, res: Response) => {
    const otp = parseOtp(req);

    const parsedBody = scanBridgeUploadSchema.safeParse(req.body);
    if (!parsedBody.success) {
      // Bridge rules run after the shared scan schema's, so the last issue holds the readable
      // message ("larger than 5 MB") the phone can show as-is.
      const issues = parsedBody.error.issues;
      throw new HttpError(
        400,
        issues[issues.length - 1]?.message ?? 'Invalid payload'
      );
    }

    const result = await updateBridgeSession(otp, parsedBody.data);
    if (!result.ok) {
      if (result.reason === 'already_uploaded')
        throw new HttpError(409, 'OTP already used');
      // 410, not 404: the code was real, so the phone can say who closed it.
      if (result.reason === 'cancelled') {
        throw new HttpError(410, 'This scan was closed on the computer');
      }
      throw new HttpError(404, 'Invalid or expired OTP');
    }
    return sendOk(res, 'Scan uploaded', { status: 'uploaded' });
  }
);

/** Idempotent: closing twice, or after expiry, is still a success. */
export const cancelScanSession = asyncHandler(
  async (req: Request, res: Response) => {
    await cancelBridgeSession(parseOtp(req));
    return sendNoContent(res, 'Scan session closed');
  }
);

export const getScanStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const session = await getBridgeSession(parseOtp(req));
    // 200, not 404: an expired code is a normal answer for the polling desktop.
    if (!session)
      return sendOk(res, 'Scan session not found', { status: 'invalid' });

    return sendOk(res, 'Scan session status', {
      otp: session.otp,
      status: session.status,
      expiresIn: getRemainingSessionTtlSeconds(session.createdAt),
      imageBase64: session.imageBase64,
      imageUrl: session.imageUrl,
    });
  }
);
