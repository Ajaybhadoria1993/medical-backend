import redisClient from '../configurations/redisConfig';
import logger from './logger';

const ATTEMPT_EXPIRY = 3600; // 1 hour
const MAX_FAILED_ATTEMPTS = 5;

/**
 * Tracks a failed attempt for a given key (e.g., IP or email)
 * @param key The key to track (e.g., 'login_fail:127.0.0.1' or 'login_fail:user@example.com')
 * @returns The current number of failed attempts
 */
export const trackFailedAttempt = async (key: string): Promise<number> => {
  try {
    const attempts = await redisClient.incr(key);
    if (attempts === 1) {
      await redisClient.expire(key, ATTEMPT_EXPIRY);
    }
    return attempts;
  } catch (error) {
    logger.error(`Error tracking failed attempt for ${key}:`, error);
    return 0;
  }
};

/**
 * Gets the number of failed attempts for a given key
 * @param key The key to check
 * @returns The number of failed attempts
 */
export const getFailedAttempts = async (key: string): Promise<number> => {
  try {
    const attempts = await redisClient.get(key);
    return attempts ? parseInt(attempts, 10) : 0;
  } catch (error) {
    logger.error(`Error getting failed attempts for ${key}:`, error);
    return 0;
  }
};

/**
 * Resets the failed attempts for a given key
 * @param key The key to reset
 */
export const resetFailedAttempts = async (key: string): Promise<void> => {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error(`Error resetting failed attempts for ${key}:`, error);
  }
};

/**
 * Determines if Turnstile should be enforced for a given key
 * @param key The key to check
 * @returns boolean
 */
export const shouldEnforceTurnstile = async (key: string): Promise<boolean> => {
  const attempts = await getFailedAttempts(key);
  return attempts >= MAX_FAILED_ATTEMPTS;
};
