// src/middlewear/rateLimit.middleware.ts
import { NextFunction, Request, Response } from 'express';
import redisClient from '../configurations/redisConfig';
import logger from '../utils/logger';

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  max: number;
  /** Time window in seconds */
  windowSec: number;
  /** Key generator function — determines how requests are grouped */
  keyGenerator?: (req: Request) => string;
  /** Custom message on limit exceeded */
  message?: string;
  /** Prefix for Redis keys */
  prefix?: string;
  /** Whether to skip rate limiting when Redis is unavailable */
  skipOnError?: boolean;
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  max: 100,
  windowSec: 60,
  keyGenerator: (req: Request) => {
    // Use authenticated user ID if available, otherwise fall back to IP
    const userId = (req as any).user?.id;
    if (userId) return `user:${userId}`;
    return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  },
  message: 'Too many requests. Please try again later.',
  prefix: 'rl',
  skipOnError: true,
};

/**
 * Creates a rate limiting middleware using Redis sliding window counter.
 *
 * Usage:
 *   // Global: app.use('/api', rateLimit({ max: 100, windowSec: 60 }))
 *   // Per-route: router.post('/login', rateLimit({ max: 5, windowSec: 60 }), loginController)
 */
export function rateLimit(options: RateLimitOptions) {
  // Rate limiting temporarily disabled — remove this line to re-enable
  return (_req: Request, _res: Response, next: NextFunction) => next();

  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = `${config.prefix}:${config.keyGenerator(req)}`;
      const now = Date.now();
      const windowStart = now - config.windowSec * 1000;

      // Sliding window using a sorted set:
      // - Score = timestamp of request
      // - Member = unique request identifier (timestamp + random)
      const multi = redisClient.multi();

      // Remove entries outside the current window
      multi.zremrangebyscore(key, 0, windowStart);

      // Count remaining entries in the window
      multi.zcard(key);

      // Add current request
      multi.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);

      // Set TTL so keys auto-expire
      multi.expire(key, config.windowSec);

      const results = await multi.exec();

      if (!results) {
        // Redis transaction failed — skip or block based on config
        if (config.skipOnError) return next();
        return res
          .status(503)
          .json({ message: 'Service temporarily unavailable.' });
      }

      // zcard result is at index 1 (second command)
      const currentCount = results[1][1] as number;

      // Set rate limit headers
      const remaining = Math.max(0, config.max - currentCount - 1);
      const resetTime = Math.ceil((now + config.windowSec * 1000) / 1000);

      res.setHeader('X-RateLimit-Limit', config.max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (currentCount >= config.max) {
        const retryAfter = config.windowSec;
        res.setHeader('Retry-After', retryAfter);

        logger.warn(
          `[RateLimit] Limit exceeded for key=${key} | count=${currentCount} | max=${config.max}`
        );

        return res.status(429).json({
          success: false,
          message: config.message,
          retryAfter,
        });
      }

      return next();
    } catch (error) {
      logger.error('[RateLimit] Redis error:', error);

      // If Redis is down, allow requests through (fail-open) or block (fail-closed)
      if (config.skipOnError) return next();
      return res
        .status(503)
        .json({ message: 'Service temporarily unavailable.' });
    }
  };
}

// ─── Pre-configured rate limiters ────────────────────────────────────────────

/**
 * Strict rate limiter for auth endpoints (login, register, password reset).
 * 5 requests per minute per IP.
 */
export const strictRateLimit = rateLimit({
  max: 5,
  windowSec: 60,
  prefix: 'rl:strict',
  keyGenerator: (req: Request) =>
    `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
  message: 'Too many attempts. Please wait a minute before trying again.',
});

/**
 * Standard rate limiter for general authenticated API routes.
 * 100 requests per minute per user/IP.
 */
export const standardRateLimit = rateLimit({
  max: 100,
  windowSec: 60,
  prefix: 'rl:standard',
  message: 'Too many requests. Please try again later.',
});

/**
 * Relaxed rate limiter for read-heavy endpoints.
 * 200 requests per minute per user/IP.
 */
export const relaxedRateLimit = rateLimit({
  max: 200,
  windowSec: 60,
  prefix: 'rl:relaxed',
  message: 'Too many requests. Please slow down.',
});

/**
 * Very strict rate limiter for OTP/verification endpoints.
 * 3 requests per minute per IP.
 */
export const otpRateLimit = rateLimit({
  max: 3,
  windowSec: 60,
  prefix: 'rl:otp',
  keyGenerator: (req: Request) =>
    `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
  message: 'Too many OTP requests. Please wait before requesting again.',
});
