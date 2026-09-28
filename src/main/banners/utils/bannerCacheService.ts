/**
 * Banner Cache Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Cache-Aside (Lazy Loading) pattern for banner eligibility queries.
 *
 * Architecture:
 * - Cache key format: `banners:eligible:{userId}:{placement}` (placement-specific)
 * - Cache key format: `banners:eligible:all:{userId}` (all placements)
 * - Invalidation key prefix: `banners:` (wildcard deletion on banner changes)
 *
 * Benefits:
 * - Reduces database load by caching frequently-accessed eligible banners
 * - Improves API response times significantly
 * - Automatic TTL-based expiry (5 minutes)
 * - Graceful fallback if Redis is unavailable
 *
 * Usage Pattern:
 * 1. Check Redis for cached data
 * 2. If hit: return cached response + log hit
 * 3. If miss: execute business logic, cache result, return response + log miss
 * 4. On banner changes: invalidate all banner-related cache keys
 */

import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

// Cache configuration
const BANNER_CACHE_TTL = 300; // 5 minutes (production-optimized)
const BANNER_CACHE_PREFIX = 'banners:eligible:';
const BANNER_INVALIDATION_PREFIX = 'banners:';

/**
 * Helper: Generate cache key for placement-specific eligible banners
 * Pattern: banners:eligible:{userId}:{placement}
 * Example: banners:eligible:123e4567-e89b-12d3-a456-426614174000:DASHBOARD_TOP
 */
export const getCacheKeyPlacement = (
  userId: string,
  placement: string
): string => {
  return `${BANNER_CACHE_PREFIX}${userId}:${placement}`;
};

/**
 * Helper: Generate cache key for all placements eligible banners
 * Pattern: banners:eligible:all:{userId}
 * Example: banners:eligible:all:123e4567-e89b-12d3-a456-426614174000
 */
export const getCacheKeyAllPlacements = (userId: string): string => {
  return `${BANNER_CACHE_PREFIX}all:${userId}`;
};

/**
 * Cache GET: Retrieve eligible banners from Redis
 *
 * @param cacheKey - The Redis cache key
 * @returns Parsed cached data or null if cache miss
 *
 * Example:
 * const cached = await getBannerCache('banners:eligible:123:DASHBOARD_TOP');
 */
export const getBannerCache = async <T = unknown>(
  cacheKey: string
): Promise<T | null> => {
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    return null;
  } catch (error) {
    // Log error but don't throw — cache failures should not break the API
    logger.warn('Banner cache GET error', {
      cacheKey,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
};

/**
 * Cache SET: Store eligible banners in Redis with TTL
 *
 * @param cacheKey - The Redis cache key
 * @param data - Data to cache (will be JSON stringified)
 * @param ttl - Time to live in seconds (defaults to BANNER_CACHE_TTL)
 * @returns true if cached successfully, false if error
 *
 * Example:
 * await setBannerCache('banners:eligible:123:DASHBOARD_TOP', bannerArray, 300);
 */
export const setBannerCache = async (
  cacheKey: string,
  data: unknown,
  ttl: number = BANNER_CACHE_TTL
): Promise<boolean> => {
  try {
    await redisClient.setex(cacheKey, ttl, JSON.stringify(data));
    return true;
  } catch (error) {
    // Log error but don't throw — cache failures should not break the API
    logger.warn('Banner cache SET error', {
      cacheKey,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
};

/**
 * Cache INVALIDATE: Delete all banner-related cache keys
 *
 * Uses Redis SCAN + DEL pattern to efficiently delete keys matching prefix.
 * Safer than FLUSHDB for multi-tenant environments.
 *
 * Invalidates:
 * - All placement-specific eligible banner caches
 * - All all-placements eligible banner caches
 *
 * Example:
 * await invalidateBannerCache();
 */
export const invalidateBannerCache = async (): Promise<void> => {
  try {
    // Use SCAN to find all keys with the banner prefix
    // This is safer than KEYS for production (non-blocking)
    let cursor = '0';
    let totalDeleted = 0;

    do {
      const [newCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        `${BANNER_INVALIDATION_PREFIX}*`,
        'COUNT',
        100
      );

      if (keys.length > 0) {
        await redisClient.del(...keys);
        totalDeleted += keys.length;
      }

      cursor = newCursor;
    } while (cursor !== '0');

    logger.info('Banner cache invalidated', {
      prefix: BANNER_INVALIDATION_PREFIX,
      keysDeleted: totalDeleted,
    });
  } catch (error) {
    // Log error but don't throw — cache invalidation failures should not break the API
    logger.error('Banner cache INVALIDATION error', {
      prefix: BANNER_INVALIDATION_PREFIX,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Cache-Aside Pattern: Get or Set
 *
 * Implements the full cache-aside (lazy loading) pattern:
 * 1. Try to get from cache
 * 2. If cache miss, execute fetcher function
 * 3. Store result in cache with TTL
 * 4. Return result
 *
 * @param cacheKey - The Redis cache key
 * @param fetcher - Async function that fetches data if cache miss
 * @param ttl - Time to live in seconds
 * @returns Data from cache or fetcher
 *
 * Example:
 * const banners = await cacheAsideBanner(
 *   'banners:eligible:123:DASHBOARD_TOP',
 *   () => BannerService.getEligibleBanners(...),
 *   300
 * );
 */
export const cacheAsideBanner = async <T = unknown>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttl: number = BANNER_CACHE_TTL
): Promise<T> => {
  // Attempt cache hit
  const cached = await getBannerCache<T>(cacheKey);
  if (cached) {
    return cached;
  }

  // Cache miss: execute fetcher and store result
  const data = await fetcher();
  await setBannerCache(cacheKey, data, ttl);

  return data;
};

/**
 * Logging utilities for monitoring cache performance
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const logCacheHit = (
  cacheKey: string,
  userId: string,
  placement?: string,
  executionTime?: number
): void => {
  logger.info('Banner Cache HIT', {
    cacheKey,
    userId,
    placement: placement || 'all',
    executionTime: `${executionTime || 0}ms`,
  });
};

export const logCacheMiss = (
  cacheKey: string,
  userId: string,
  placement?: string,
  executionTime?: number
): void => {
  logger.info('Banner Cache MISS', {
    cacheKey,
    userId,
    placement: placement || 'all',
    executionTime: `${executionTime || 0}ms`,
  });
};

export const logCacheInvalidation = (reason: string): void => {
  logger.info('Banner Cache INVALIDATED', {
    reason,
    timestamp: new Date().toISOString(),
  });
};
