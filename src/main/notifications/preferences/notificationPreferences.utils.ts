import { eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { UserModel } from '../../users/models/user.model';
import { SettingModel } from '../../settings/models/setting.model';
import {
  NON_CONFIGURABLE_NOTIFICATIONS,
  getRoleDefaults,
} from './notificationPreferences.constants';
import logger from '../../../utils/logger';

export interface ResolvedPreferenceSetting {
  enabled: boolean;
  configurable: boolean;
}

export interface ResolvedPreferences {
  inApp: Record<string, ResolvedPreferenceSetting>;
  push: Record<string, ResolvedPreferenceSetting>;
}

const REDIS_KEY_PREFIX = 'notif_prefs:';
const CACHE_TTL = 300; // 5 minutes in seconds

/**
 * Resolves full notification preferences for a user by merging role defaults and user overrides.
 * Caches the resolved structure in Redis.
 */
export async function resolveNotificationPreferences(
  userId: string,
  role: string
): Promise<ResolvedPreferences> {
  const cacheKey = `${REDIS_KEY_PREFIX}${userId}`;

  // 1. Try to fetch from Redis cache
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn(
      `[NotificationPreferences] Redis read failed for user ${userId}:`,
      err
    );
  }

  // 2. Fetch user's settings overrides from DB
  let userOverrides: Record<string, Record<string, boolean>> = {};
  try {
    const [setting] = await database
      .select({
        notificationPreferences: SettingModel.notificationPreferences,
      })
      .from(SettingModel)
      .where(eq(SettingModel.userId, userId))
      .limit(1);

    if (setting && setting.notificationPreferences) {
      userOverrides = setting.notificationPreferences as Record<
        string,
        Record<string, boolean>
      >;
    }
  } catch (err) {
    logger.error(
      `[NotificationPreferences] DB fetch failed for user ${userId}:`,
      err
    );
  }

  // 3. Resolve preferences (Merge role defaults with user overrides)
  const roleDefaults = getRoleDefaults(role);
  const resolved: ResolvedPreferences = {
    inApp: {},
    push: {},
  };

  // Resolve inApp preferences
  const inAppEvents = new Set([
    ...Object.keys(roleDefaults.inApp),
    ...Object.keys(userOverrides.inApp || {}),
    ...NON_CONFIGURABLE_NOTIFICATIONS,
  ]);

  for (const event of inAppEvents) {
    // Non-configurable notifications are always ON
    if (NON_CONFIGURABLE_NOTIFICATIONS.includes(event)) {
      resolved.inApp[event] = { enabled: true, configurable: false };
      continue;
    }

    const defaultVal = roleDefaults.inApp[event]?.enabled ?? true;
    const userVal = userOverrides.inApp?.[event];

    resolved.inApp[event] = {
      enabled: typeof userVal === 'boolean' ? userVal : defaultVal,
      configurable: true,
    };
  }

  // Resolve push preferences
  const pushEvents = new Set([
    ...Object.keys(roleDefaults.push),
    ...Object.keys(userOverrides.push || {}),
    ...NON_CONFIGURABLE_NOTIFICATIONS,
  ]);

  for (const event of pushEvents) {
    // Non-configurable notifications are always ON
    if (NON_CONFIGURABLE_NOTIFICATIONS.includes(event)) {
      resolved.push[event] = { enabled: true, configurable: false };
      continue;
    }

    const defaultVal = roleDefaults.push[event]?.enabled ?? true;
    const userVal = userOverrides.push?.[event];

    resolved.push[event] = {
      enabled: typeof userVal === 'boolean' ? userVal : defaultVal,
      configurable: true,
    };
  }

  // 4. Cache resolved preferences in Redis
  try {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(resolved));
  } catch (err) {
    logger.warn(
      `[NotificationPreferences] Redis write failed for user ${userId}:`,
      err
    );
  }

  return resolved;
}

/**
 * Checks in-app and push preference settings for a single user and notification action/event.
 */
export async function getUserNotificationPreference(
  userId: string,
  action: string
): Promise<{ inApp: boolean; push: boolean }> {
  // If the event is non-configurable, it is always enabled
  if (NON_CONFIGURABLE_NOTIFICATIONS.includes(action)) {
    return { inApp: true, push: true };
  }

  try {
    const cacheKey = `${REDIS_KEY_PREFIX}${userId}`;
    let resolved: ResolvedPreferences | null = null;

    // 1. Try Redis cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      resolved = JSON.parse(cached);
    } else {
      // 2. Cache miss: Query user & resolve
      const [user] = await database
        .select({
          userType: UserModel.userType,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);

      if (user) {
        resolved = await resolveNotificationPreferences(userId, user.userType);
      }
    }

    if (resolved) {
      const inAppEnabled = resolved.inApp[action]?.enabled ?? true;
      const pushEnabled = resolved.push[action]?.enabled ?? true;
      return { inApp: inAppEnabled, push: pushEnabled };
    }
  } catch (err) {
    logger.error(
      `[NotificationPreferences] Error resolving preferences for user=${userId}, action=${action}:`,
      err
    );
  }

  // Fail-safe: default to enabled
  return { inApp: true, push: true };
}

/**
 * Preferences for many users at once.
 *
 * The single-user version above is one Redis read and, on a miss, one query —
 * per recipient. A fan-out therefore cost N of each. This does one MGET and one
 * query for whichever users missed the cache, which matters most exactly when it
 * is worst: a cold cache after a deploy or a restart.
 *
 * Unresolvable users default to enabled, matching the single-user fail-safe.
 */
export async function getUserNotificationPreferences(
  userIds: string[],
  action: string
): Promise<Map<string, { inApp: boolean; push: boolean }>> {
  const out = new Map<string, { inApp: boolean; push: boolean }>();
  if (!userIds.length) return out;

  const enabled = { inApp: true, push: true };
  if (NON_CONFIGURABLE_NOTIFICATIONS.includes(action)) {
    for (const id of userIds) out.set(id, enabled);
    return out;
  }

  const read = (resolved: ResolvedPreferences) => ({
    inApp: resolved.inApp[action]?.enabled ?? true,
    push: resolved.push[action]?.enabled ?? true,
  });

  let cached: (string | null)[] = [];
  try {
    cached = await redisClient.mget(
      ...userIds.map((id) => `${REDIS_KEY_PREFIX}${id}`)
    );
  } catch {
    cached = userIds.map(() => null);
  }

  const missed: string[] = [];
  userIds.forEach((id, i) => {
    const raw = cached[i];
    if (!raw) return missed.push(id);
    try {
      out.set(id, read(JSON.parse(raw) as ResolvedPreferences));
    } catch {
      missed.push(id);
    }
  });

  if (missed.length) {
    try {
      const users = await database
        .select({ id: UserModel.id, userType: UserModel.userType })
        .from(UserModel)
        .where(inArray(UserModel.id, missed));

      await Promise.all(
        users.map(async (user) => {
          const resolved = await resolveNotificationPreferences(
            user.id,
            user.userType
          );
          if (resolved) out.set(user.id, read(resolved));
        })
      );
    } catch (err) {
      logger.error(
        `[NotificationPreferences] Batch resolve failed for action=${action}:`,
        err
      );
    }
  }

  for (const id of userIds) if (!out.has(id)) out.set(id, enabled);
  return out;
}

/**
 * Invalidates the Redis preference cache for a user.
 */
export async function invalidateNotificationPreferenceCache(
  userId: string
): Promise<void> {
  const cacheKey = `${REDIS_KEY_PREFIX}${userId}`;
  try {
    await redisClient.del(cacheKey);
  } catch (err) {
    logger.warn(
      `[NotificationPreferences] Redis delete failed for user ${userId}:`,
      err
    );
  }
}
