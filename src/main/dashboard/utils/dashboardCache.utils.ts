import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { CacheKeys } from '../../../utils/cache.util';

/** The clinic's current dashboard cache version; "0" until the first change. */
export async function getDashboardCacheVersion(
  clinicId: string
): Promise<string> {
  try {
    return (
      (await redisClient.get(CacheKeys.dashboardCacheVersion(clinicId))) ?? '0'
    );
  } catch (err) {
    // Unversioned reads would risk serving stale data, so a fresh key is safer.
    logger.warn(
      `[dashboardCache] Version read failed for clinic=${clinicId}`,
      err
    );
    return `unavailable-${Date.now()}`;
  }
}

/**
 * Retires every cached dashboard snapshot for the clinic: old keys are simply never
 * read again and expire on their own TTL. Never throws — the write already committed.
 */
export async function invalidateClinicDashboardCaches(
  clinicId: string
): Promise<void> {
  try {
    await redisClient.incr(CacheKeys.dashboardCacheVersion(clinicId));
  } catch (err) {
    logger.warn(
      `[dashboardCache] Version bump failed for clinic=${clinicId}`,
      err
    );
  }
}
