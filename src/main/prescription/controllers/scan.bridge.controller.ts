import { Request, Response } from 'express';
import { generateOTP } from '../services/otp.service';
import {
  BRIDGE_TTL_SECONDS,
  createUniqueBridgeSession,
  getBridgeSession,
  getRemainingSessionTtlSeconds,
  updateBridgeSession,
} from '../services/scan.bridge.service';
import {
  scanBridgeOtpQuerySchema,
  scanBridgeUploadSchema,
} from '../validators/scan.bridge.validator';

export const createScanSession = (_req: Request, res: Response) => {
  const session = createUniqueBridgeSession(generateOTP, 5);

  if (!session) {
    return res.status(503).json({
      message: 'Could not create scan session. Please retry.',
    });
  }

  return res.status(201).json({
    otp: session.otp,
    expiresIn: BRIDGE_TTL_SECONDS,
  });
};

export const uploadScanViaOtp = (req: Request, res: Response) => {
  const parsedQuery = scanBridgeOtpQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      message: 'Invalid OTP',
      issues: parsedQuery.error.issues,
    });
  }

  const parsedBody = scanBridgeUploadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      // Bridge rules run after the shared scan schema's, so the last issue holds the readable
      // message ("larger than 5 MB") the phone can show as-is.
      message:
        parsedBody.error.issues[parsedBody.error.issues.length - 1]?.message ??
        'Invalid payload',
      issues: parsedBody.error.issues,
    });
  }

  const result = updateBridgeSession(parsedQuery.data.otp, parsedBody.data);

  if (!result.ok) {
    if (result.reason === 'already_uploaded') {
      return res.status(409).json({
        message: 'OTP already used',
      });
    }

    return res.status(404).json({
      message: 'Invalid or expired OTP',
    });
  }

  return res.status(200).json({
    status: 'uploaded',
  });
};

export const getScanStatus = (req: Request, res: Response) => {
  const parsedQuery = scanBridgeOtpQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      message: 'Invalid OTP',
      issues: parsedQuery.error.issues,
    });
  }

  const session = getBridgeSession(parsedQuery.data.otp);

  if (!session) {
    return res.status(200).json({
      status: 'invalid',
    });
  }

  return res.status(200).json({
    otp: session.otp,
    status: session.status,
    expiresIn: getRemainingSessionTtlSeconds(session.createdAt),
    imageBase64: session.imageBase64,
    imageUrl: session.imageUrl,
  });
};
