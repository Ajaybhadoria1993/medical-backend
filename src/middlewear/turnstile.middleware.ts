import { Request, Response, NextFunction } from 'express';
import { verifyTurnstileToken } from '../utils/turnstile';
import { shouldEnforceTurnstile } from '../utils/security';
import { HttpError } from './errorHandler';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';

/**
 * Middleware to enforce Turnstile CAPTCHA verification
 * @param force If true, Turnstile is always enforced. If false, it's enforced based on security logic (e.g., failed attempts).
 */
export const requireTurnstile = (force: boolean = true) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress;

      // Skip verification ONLY if NODE_ENV is development
      if (envConfig.NODE_ENV === 'development') {
        return next();
      }

      // Skip verification for the superadmin account (break-glass access)
      const submittedEmail = req.body?.email;
      if (
        submittedEmail &&
        envConfig.SUPER_ADMIN_EMAIL &&
        String(submittedEmail).toLowerCase().trim() ===
          envConfig.SUPER_ADMIN_EMAIL.toLowerCase().trim()
      ) {
        return next();
      }

      const turnstileToken =
        req.body.turnstileToken ||
        req.body.captchaToken ||
        req.headers['x-turnstile-token'] ||
        req.headers['x-captcha-token'];

      // Check if we should enforce Turnstile
      let isEnforced = force;

      if (!isEnforced) {
        // Example: Enforce Turnstile based on IP or other signals if not explicitly forced
        const ipKey = `failed_attempts:ip:${clientIp}`;
        isEnforced = await shouldEnforceTurnstile(ipKey);
      }

      if (isEnforced) {
        if (!turnstileToken) {
          logger.warn(`Turnstile token missing for request from ${clientIp}`);
          throw new HttpError(
            400,
            'Security verification required. Please complete the CAPTCHA.'
          );
        }

        const isValid = await verifyTurnstileToken(turnstileToken, clientIp);
        if (!isValid) {
          logger.warn(`Invalid Turnstile token from ${clientIp}`);
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
