import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';

const IS_SERVER = ['production', 'staging'].includes(envConfig.NODE_ENV);
const SLOW_REQUEST_MS = 2000;

// Ids become ":id" so one API logs as one path; Express 5 drops the route name once an error leaves its router.
export const logPath = (req: Request) =>
  req.originalUrl
    .split('?')[0]
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || (seg.length >= 16 && /\d/.test(seg)) ? ':id' : seg
    )
    .join('/');

/**
 * Logs requests as one structured line, tagged with a requestId that errorHandler and X-Request-Id share.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Listen for the 'finish' event to log after the response is sent
  res.on('finish', () => {
    const { statusCode: status } = res;
    const ms = Date.now() - start;
    // Servers skip fast successes (~90% of volume) to keep CloudWatch cost capped.
    if (IS_SERVER && status < 400 && ms < SLOW_REQUEST_MS) return;
    // Query string dropped: it can carry phone numbers or tokens.
    const path = logPath(req);
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    logger.log(level, `${req.method} ${path} ${status} - ${ms}ms`, {
      type: 'request',
      requestId,
      method: req.method,
      path,
      status,
      ms,
      clinicId: req.clinicId,
      // No userId, by privacy decision: clinic + role + requestId is enough to trace a call.
      userType: req.user?.userType,
    });
  });

  next();
};
