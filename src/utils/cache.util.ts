import redisClient from '../configurations/redisConfig';
import logger from './logger';

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  try {
    const cached = await redisClient.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    logger.error(`[cache.util] Failed to read cache key "${key}":`, err);
  }

  const result = await loader();

  try {
    await redisClient.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  } catch (err) {
    logger.error(`[cache.util] Failed to write cache key "${key}":`, err);
  }

  return result;
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error(`[cache.util] Failed to invalidate cache key "${key}":`, err);
  }
}

export async function invalidateCacheMany(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await redisClient.del(...keys);
  } catch (err) {
    logger.error(
      `[cache.util] Failed to invalidate cache keys "${keys.join(', ')}":`,
      err
    );
  }
}

/**
 * Delete every key matching a glob (e.g. `dashboard:reception-overview:<id>:*`).
 *
 * For key families whose full name depends on the *reader* rather than the data
 * — a receptionist's doctor scope, for one — so a writer cannot name them all.
 * Uses SCAN rather than KEYS: this runs on the appointment write path, and KEYS
 * blocks the whole Redis server for the length of the scan.
 */
export async function invalidateCacheByPattern(pattern: string): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200
      );
      cursor = next;
      if (keys.length) await redisClient.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.error(
      `[cache.util] Failed to invalidate cache pattern "${pattern}":`,
      err
    );
  }
}

// Only invalidates on success — if `mutation` throws, the underlying write
// rolled back, so the cached value is still accurate and left untouched.
export function withCacheInvalidation<T>(
  cacheKey: string,
  mutation: () => Promise<T>
): Promise<T> {
  return mutation().then((result) => {
    return invalidateCache(cacheKey).then(() => result);
  });
}

const doctorPublicProfileKey = (doctorId: string) =>
  `doctor_public_profile:${doctorId}`;
const doctorPublicProfileWebKey = (doctorId: string) =>
  `doctor_public_profile_web:${doctorId}`;
const doctorPublicProfileFullKey = (doctorId: string) =>
  `doctor_public_profile_full:${doctorId}`;
const doctorDisplayNameKey = (doctorId: string) =>
  `doctor_display_name:${doctorId}`;

export const CacheKeys = {
  clinicProfileOverview: (clinicId: string) =>
    `clinic:profile-overview:${clinicId}`,
  userPermissions: (userId: string, clinicId: string) =>
    `perm:${userId}:${clinicId}`,
  staffScope: (userId: string, clinicId: string) =>
    `staff:scope:${userId}:${clinicId}`,
  // Live doctor→reception calls: a hash of doctorId → call JSON.
  clinicCalls: (clinicId: string) => `calls:${clinicId}`,
  receptionOverview: (clinicId: string, doctorId?: string, scopeKey?: string) =>
    `dashboard:reception-overview:${clinicId}:${doctorId ?? 'all'}:${
      scopeKey ?? 'all'
    }`,
  receptionOverviewPattern: (clinicId: string) =>
    `dashboard:reception-overview:${clinicId}:*`,
  // Bumped on every appointment or payment change. Keys below embed it, so a bump
  // retires every cached dashboard snapshot for the clinic in one O(1) write.
  dashboardCacheVersion: (clinicId: string) =>
    `dashboard:cache-version:${clinicId}`,
  receptionTodayStats: (clinicId: string, version: string, scopeKey?: string) =>
    `dashboard:reception-today-stats:${clinicId}:v${version}:${scopeKey ?? 'all'}`,
  revenueOverview: (
    clinicId: string,
    version: string,
    doctorId: string | null,
    startYmd: string,
    endYmd: string
  ) =>
    `revenue_overview:${clinicId}:v${version}:${doctorId ? `doctor:${doctorId}` : 'all'}:${startYmd}:${endYmd}`,
  // No doctorId = clinic-wide, the admin dashboard's view.
  todayOverview: (
    clinicId: string,
    version: string,
    doctorId?: string | null
  ) =>
    `today_overview:${clinicId}:v${version}:${doctorId ? `doctor:${doctorId}` : 'all'}`,
  clinicDashboard: (
    clinicId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) => `dashboard:clinic:${clinicId}:v${version}:${startYmd}:${endYmd}`,
  clinicDoctorList: (clinicId: string, scopeKey?: string) =>
    `doctors:list:${clinicId}:${scopeKey ?? 'all'}`,
  clinicDoctorListPattern: (clinicId: string) => `doctors:list:${clinicId}*`,
  // Set once a shift has an arrival; arrivals are append-only, so it never needs clearing.
  doctorShiftArrived: (
    clinicId: string,
    doctorId: string,
    date: string,
    sessionIndex: number
  ) => `doctor_arrival:seen:${clinicId}:${doctorId}:${date}:s${sessionIndex}`,
  // Versioned like the other dashboards: a clinic version bump retires every range at once, no pattern wipe needed.
  doctorDashboardV2Live: (
    clinicId: string,
    doctorId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) =>
    `doctor_dashboard_v2_live:${clinicId}:${doctorId}:v${version}:${startYmd}:${endYmd}`,
  doctorDashboardV2Analytics: (
    clinicId: string,
    doctorId: string,
    version: string,
    startYmd: string,
    endYmd: string
  ) =>
    `doctor_dashboard_v2_analytics:${clinicId}:${doctorId}:v${version}:${startYmd}:${endYmd}`,
  // The patient-app and public-web payloads differ (clinic filtering, reviews,
  // timings), so they cache separately and must be invalidated together.
  doctorPublicProfile: doctorPublicProfileKey,
  doctorPublicProfileWeb: doctorPublicProfileWebKey,
  // The fully assembled public response (profile + timings + reviews).
  doctorPublicProfileFull: doctorPublicProfileFullKey,
  // Doctor's display name for patient push copy (queue, running-late, shift).
  doctorDisplayName: doctorDisplayNameKey,
  // Every per-doctor key a profile write can stale. The display name rides
  // along so each existing profile-write invalidation clears it too.
  doctorPublicProfileAll: (doctorId: string) => [
    doctorPublicProfileKey(doctorId),
    doctorPublicProfileWebKey(doctorId),
    doctorPublicProfileFullKey(doctorId),
    doctorDisplayNameKey(doctorId),
  ],
} as const;
