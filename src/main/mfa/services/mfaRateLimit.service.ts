import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

const MFA_RATE_LIMIT_PREFIX = 'mfa:rate';
const MFA_RATE_LIMIT_MAX_ATTEMPTS = 5;
const MFA_RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}

/**
 * Checks whether the user is within the MFA verification rate limit.
 * Fail-closed: if Redis is unavailable, verification is rejected.
 */
export async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  const key = `${MFA_RATE_LIMIT_PREFIX}:${userId}`;

  try {
    const attemptsStr = await redisClient.get(key);
    const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

    if (attempts >= MFA_RATE_LIMIT_MAX_ATTEMPTS) {
      const ttl = await redisClient.ttl(key);
      const retryAfterSeconds = ttl > 0 ? ttl : MFA_RATE_LIMIT_WINDOW_SECONDS;

      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remainingAttempts: MFA_RATE_LIMIT_MAX_ATTEMPTS - attempts,
    };
  } catch (error) {
    // Fail-closed: reject if Redis is unavailable
    logger.error('[MFA RateLimit] Redis error during checkRateLimit:', error);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: MFA_RATE_LIMIT_WINDOW_SECONDS,
    };
  }
}

/**
 * Increments the failed MFA verification attempt counter for a user.
 * Sets the TTL to 900s (15 minutes) on first failure.
 * Fail-closed: if Redis is unavailable, returns a rejected result.
 */
export async function incrementFailedAttempts(
  userId: string
): Promise<RateLimitResult> {
  const key = `${MFA_RATE_LIMIT_PREFIX}:${userId}`;

  try {
    const newCount = await redisClient.incr(key);

    // Set TTL only on the first increment (when key is newly created)
    if (newCount === 1) {
      await redisClient.expire(key, MFA_RATE_LIMIT_WINDOW_SECONDS);
    }

    const remainingAttempts = Math.max(
      0,
      MFA_RATE_LIMIT_MAX_ATTEMPTS - newCount
    );

    if (remainingAttempts === 0) {
      const ttl = await redisClient.ttl(key);
      const retryAfterSeconds = ttl > 0 ? ttl : MFA_RATE_LIMIT_WINDOW_SECONDS;

      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remainingAttempts,
    };
  } catch (error) {
    // Fail-closed: reject if Redis is unavailable
    logger.error(
      '[MFA RateLimit] Redis error during incrementFailedAttempts:',
      error
    );
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: MFA_RATE_LIMIT_WINDOW_SECONDS,
    };
  }
}

/**
 * Resets the MFA rate limit counter for a user (e.g., after successful verification).
 * Fail-closed: if Redis is unavailable, returns a rejected result.
 */
export async function resetRateLimit(userId: string): Promise<RateLimitResult> {
  const key = `${MFA_RATE_LIMIT_PREFIX}:${userId}`;

  try {
    await redisClient.del(key);

    return {
      allowed: true,
      remainingAttempts: MFA_RATE_LIMIT_MAX_ATTEMPTS,
    };
  } catch (error) {
    // Fail-closed: reject if Redis is unavailable
    logger.error('[MFA RateLimit] Redis error during resetRateLimit:', error);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: MFA_RATE_LIMIT_WINDOW_SECONDS,
    };
  }
}
