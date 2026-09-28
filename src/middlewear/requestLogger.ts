import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Middleware to log each incoming request and its response status code.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();

  // Listen for the 'finish' event to log after the response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    const logMessage = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;

    if (statusCode >= 500) {
      logger.error(logMessage);
    } else if (statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.info(logMessage);
    }
  });

  next();
};
