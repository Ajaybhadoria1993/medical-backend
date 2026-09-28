/**
 * Notification retention.
 *
 * Run nightly from src/cron/jobs/notificationRetention.cron.ts. Kept out of the
 * cron file so the policy is testable and readable on its own.
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { NotificationsModel } from '../models/notifications.model';

/** Read notifications older than this are removed. */
const NOTIFICATION_RETENTION_DAYS = Number(
  process.env.NOTIFICATION_RETENTION_DAYS ?? 90
);

/**
 * Activity is kept far longer: it is the record of who discounted what and who
 * took which payment, and that is what someone comes looking for months later.
 */
const ACTIVITY_RETENTION_DAYS = Number(
  process.env.NOTIFICATION_ACTIVITY_RETENTION_DAYS ?? 365
);

/**
 * Rows per statement. The table carries four indexes, and one unbounded DELETE
 * would hold locks across all of them while the inbox is being read.
 */
const BATCH_SIZE = 10_000;

/** Guard against a mistyped env var quietly deleting everything. */
const MIN_RETENTION_DAYS = 7;

function cutoff(days: number): Date {
  const safeDays = Math.max(days, MIN_RETENTION_DAYS);
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
}

async function purgeBatched(
  kind: 'notification' | 'activity',
  olderThan: Date
): Promise<number> {
  let removed = 0;

  for (;;) {
    const batch = await database
      .select({ id: NotificationsModel.id })
      .from(NotificationsModel)
      .where(
        and(
          eq(NotificationsModel.kind, kind),
          // Never delete something a person has not seen. Age does not make an
          // unread notification less unread.
          eq(NotificationsModel.read, true),
          lt(NotificationsModel.createdAt, olderThan)
        )
      )
      .limit(BATCH_SIZE);

    if (!batch.length) break;

    await database.delete(NotificationsModel).where(
      inArray(
        NotificationsModel.id,
        batch.map((row) => row.id)
      )
    );

    removed += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  return removed;
}

export async function purgeExpiredNotifications(): Promise<{
  notifications: number;
  activity: number;
}> {
  const notifications = await purgeBatched(
    'notification',
    cutoff(NOTIFICATION_RETENTION_DAYS)
  );
  const activity = await purgeBatched(
    'activity',
    cutoff(ACTIVITY_RETENTION_DAYS)
  );

  return { notifications, activity };
}

/** Rows the next run would remove. Useful before enabling this on a large table. */
export async function countExpiredNotifications(): Promise<{
  notifications: number;
  activity: number;
}> {
  const [row] = await database
    .select({
      notifications: sql<number>`count(*) filter (where ${NotificationsModel.kind} = 'notification' and ${NotificationsModel.createdAt} < ${cutoff(NOTIFICATION_RETENTION_DAYS)})`,
      activity: sql<number>`count(*) filter (where ${NotificationsModel.kind} = 'activity' and ${NotificationsModel.createdAt} < ${cutoff(ACTIVITY_RETENTION_DAYS)})`,
    })
    .from(NotificationsModel)
    .where(eq(NotificationsModel.read, true));

  return {
    notifications: Number(row?.notifications ?? 0),
    activity: Number(row?.activity ?? 0),
  };
}
