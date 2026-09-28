// src/middlewear/mfaAuth.middleware.ts
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { envConfig } from '../utils/envConfig';
import { asyncHandler, HttpError } from './errorHandler';

// Shape of the MFA temporary token payload
type MfaTokenPayload = {
  sub: string; // user id
  scope: string; // must be "mfa_verification"
  iat?: number;
  exp?: number;
};

const JWT_SECRET = envConfig.JWT_SECRET_KEY || 'change-me';

/**
 * Extract Bearer token from Authorization header
 */
function getTokenFromHeader(req: Request): string | null {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth) return null;
  const parts = String(auth).split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

/**
 * Middleware: validate temporary MFA verification token.
 * Only allows tokens with `scope: "mfa_verification"`.
 * Attaches userId to req.user.id for downstream handlers.
 */
export const requireMfaToken = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = getTokenFromHeader(req);
    if (!token) throw new HttpError(401, 'Authorization token missing');

    let payload: MfaTokenPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET) as MfaTokenPayload;
    } catch (err: unknown) {
      // Check if the error is a token expiration error
      if (err instanceof jwt.TokenExpiredError) {
        throw new HttpError(
          401,
          'MFA verification session expired. Please log in again'
        );
      }
      throw new HttpError(401, 'Invalid or expired token');
    }

    if (!payload?.sub) throw new HttpError(401, 'Invalid token payload');

    // Reject tokens without the mfa_verification scope
    if (payload.scope !== 'mfa_verification') {
      throw new HttpError(401, 'Invalid token scope');
    }

    // Attach userId to request context (same pattern as requireAuth)
    req.user = {
      id: payload.sub,
    } as any;

    return next();
  }
);
