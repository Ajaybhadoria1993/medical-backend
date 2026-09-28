import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

// TTL Definitions
const GLOBAL_POLICY_TTL = 86400; // 24 hours
const CLINIC_ACTIVE_POLICY_TTL = 86400; // 24 hours
const CLINIC_VERSION_POLICY_TTL = 604800; // 7 days (immutable)

// Key Formats
const GLOBAL_POLICY_KEY = 'cancellation:global_policy';
const CLINIC_ACTIVE_POLICY_PREFIX = 'cancellation:clinic_policy:active:';
const CLINIC_VERSION_POLICY_PREFIX = 'cancellation:clinic_policy:version:';

export class CancellationCacheService {
  /**
   * Helper to retrieve value from Redis, parsing JSON.
   */
  private static async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redisClient.get(key);
      if (data) {
        return JSON.parse(data) as T;
      }
      return null;
    } catch (error) {
      logger.warn('Cancellation Cache GET error:', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Helper to write value to Redis, stringifying JSON.
   */
  private static async set(
    key: string,
    data: unknown,
    ttl: number
  ): Promise<boolean> {
    try {
      await redisClient.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      logger.warn('Cancellation Cache SET error:', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Helper implementation of cache-aside get-or-set.
   */
  private static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      logger.info(`Cancellation Cache HIT for key: ${key}`);
      return cached;
    }

    logger.info(`Cancellation Cache MISS for key: ${key}. Fetching from DB...`);
    const data = await fetcher();

    // Cache the retrieved data if it exists/is valid (don't cache null if appropriate, or cache null briefly if needed)
    if (data !== undefined && data !== null) {
      await this.set(key, data, ttl);
    }

    return data;
  }

  /**
   * Caches and retrieves global application cancellation policy.
   */
  static async getGlobalPolicy<T>(fetcher: () => Promise<T>): Promise<T> {
    return this.getOrSet<T>(GLOBAL_POLICY_KEY, fetcher, GLOBAL_POLICY_TTL);
  }

  /**
   * Caches and retrieves current active policy for a clinic.
   */
  static async getClinicActivePolicy<T>(
    clinicId: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const key = `${CLINIC_ACTIVE_POLICY_PREFIX}${clinicId}`;
    return this.getOrSet<T>(key, fetcher, CLINIC_ACTIVE_POLICY_TTL);
  }

  /**
   * Caches and retrieves a specific immutable policy version by its ID.
   */
  static async getClinicPolicyVersion<T>(
    policyId: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const key = `${CLINIC_VERSION_POLICY_PREFIX}${policyId}`;
    return this.getOrSet<T>(key, fetcher, CLINIC_VERSION_POLICY_TTL);
  }

  /**
   * Invalidates cached active policy when changes occur.
   */
  static async invalidateClinicActivePolicy(clinicId: string): Promise<void> {
    const key = `${CLINIC_ACTIVE_POLICY_PREFIX}${clinicId}`;
    try {
      await redisClient.del(key);
      logger.info(
        `Cancellation Cache INVALIDATED active policy for clinic: ${clinicId}`
      );
    } catch (error) {
      logger.error(
        `Cancellation Cache Invalidation failure for clinic: ${clinicId}`,
        error
      );
    }
  }
}
