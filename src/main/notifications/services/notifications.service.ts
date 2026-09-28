// src/main/notifications/services/notifications.service.ts
import { database } from '../../../configurations/dbConnection';
import { NotificationsModel } from '../models/notifications.model';
import { and, count, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

export type NotificationInsert = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function createNotification(record: NotificationInsert) {
  const res = await database
    .insert(NotificationsModel)
    .values({
      userId: record.userId,
      type: record.type,
      title: record.title,
      body: record.body,
      data: record.data ?? null,
      metadata: record.metadata ?? null,
    })
    .returning();
  return res[0];
}

/**
 * Mark a single notification as read
 */
// userId is part of the WHERE clause, not a check the caller is trusted to have
// done: an id alone is not authorisation, and a second caller will not repeat it.
export async function markNotificationRead(
  userId: string,
  notificationId: string
) {
  const res = await database
    .update(NotificationsModel)
    .set({ read: true })
    .where(
      and(
        eq(NotificationsModel.id, notificationId),
        eq(NotificationsModel.userId, userId)
      )
    )
    .returning();
  return res[0];
}

/**
 * Mark ALL notifications as read for a user
 */
export async function markAllNotificationsRead(userId: string) {
  // Only ids come back: the caller needs a count, and returning full rows for a
  // user with a large unread backlog pulls the whole backlog over the wire.
  const res = await database
    .update(NotificationsModel)
    .set({ read: true })
    .where(
      and(
        eq(NotificationsModel.userId, userId),
        eq(NotificationsModel.read, false)
      )
    )
    .returning({ id: NotificationsModel.id });

  return { count: res.length };
}

/**
 * Mark one notification's work as done.
 *
 * Distinct from marking it read: reading is "I saw this", resolving is "the
 * payment is taken / the follow-up is booked". The Action Required tab counts
 * unresolved rows, so this is what actually empties it.
 *
 * `userId` is in the WHERE clause for the same reason it is on the read path —
 * an id alone is not authorisation. Already-resolved rows are left untouched
 * so the original `resolvedAt`/`resolvedBy` survive a double submit rather
 * than being overwritten by whoever clicked last.
 */
export async function resolveNotification(
  userId: string,
  notificationId: string
) {
  const res = await database
    .update(NotificationsModel)
    .set({ resolvedAt: new Date(), resolvedBy: userId, read: true })
    .where(
      and(
        eq(NotificationsModel.id, notificationId),
        eq(NotificationsModel.userId, userId),
        isNull(NotificationsModel.resolvedAt)
      )
    )
    .returning();
  return res[0];
}

/**
 * One of the caller's own notifications, or undefined.
 *
 * Lets a resolve that matched nothing tell "already resolved" apart from
 * "no such row", which are a 200 and a 404 respectively.
 */
export async function getNotificationForUser(
  userId: string,
  notificationId: string
) {
  const res = await database
    .select()
    .from(NotificationsModel)
    .where(
      and(
        eq(NotificationsModel.id, notificationId),
        eq(NotificationsModel.userId, userId)
      )
    )
    .limit(1);
  return res[0];
}

/**
 * Resolve every action-required notification tied to one subject, for every
 * recipient who got one.
 *
 * This is the auto-resolve path: when the payment is recorded, the row clears
 * itself for the whole desk rather than waiting for each receptionist to tick
 * it off individually — the work is done once, not once per person who was
 * told about it.
 *
 * Matched on `collapseKey`, which already encodes (event, subject) and is what
 * the fan-out stamps on every copy of a notification.
 */
export async function resolveByCollapseKey(
  collapseKey: string,
  resolvedBy?: string | null
) {
  const res = await database
    .update(NotificationsModel)
    .set({ resolvedAt: new Date(), resolvedBy: resolvedBy ?? null })
    .where(
      and(
        eq(NotificationsModel.collapseKey, collapseKey),
        eq(NotificationsModel.priority, 'action_required'),
        isNull(NotificationsModel.resolvedAt)
      )
    )
    .returning({ id: NotificationsModel.id });

  return { count: res.length };
}

/** Categories the Notification Center offers as tabs. */
export type NotificationCategory =
  'appointments' | 'payments' | 'prescription' | 'lab' | 'staff' | 'system';

export type NotificationKind = 'notification' | 'activity';

export interface InboxQuery {
  kind?: NotificationKind;
  category?: NotificationCategory;
  /** Action Required is a priority, not a category — it spans every tab. */
  actionRequired?: boolean;
  /**
   * Outstanding work only. Pairs with `actionRequired` to give the tab its
   * real question — "what still needs doing" rather than "what is unread".
   */
  unresolvedOnly?: boolean;
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
}

export const INBOX_PAGE_SIZE = 20;
export const INBOX_MAX_PAGE_SIZE = 50;

/** Keyset cursor — (createdAt, id) of the last row. Offset paging would shift
 *  every later page as new rows arrive. */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    'base64url'
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const createdAt = new Date(ts);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * One page of a user's inbox, newest first.
 *
 * Reads only the caller's own rows — tenant is a filter, never the access
 * boundary.
 */
export async function listInbox(userId: string, opts: InboxQuery = {}) {
  const limit = Math.min(
    Math.max(opts.limit ?? INBOX_PAGE_SIZE, 1),
    INBOX_MAX_PAGE_SIZE
  );

  const filters = [eq(NotificationsModel.userId, userId)];
  if (opts.kind) filters.push(eq(NotificationsModel.kind, opts.kind));
  if (opts.category)
    filters.push(eq(NotificationsModel.category, opts.category));
  if (opts.actionRequired)
    filters.push(eq(NotificationsModel.priority, 'action_required'));
  if (opts.unresolvedOnly) filters.push(isNull(NotificationsModel.resolvedAt));
  if (opts.unreadOnly) filters.push(eq(NotificationsModel.read, false));

  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (after) {
    // Strictly older than the cursor row, ties broken by id.
    //
    // lt/eq, not a raw sql`` template: the column helpers run createdAt through
    // the timestamp column's driver mapper, which is what turns the Date into a
    // value postgres-js accepts. Interpolating the Date into sql`` bypasses the
    // mapper and the driver rejects it with ERR_INVALID_ARG_TYPE — so only
    // cursor pages fail, never the first page.
    filters.push(
      or(
        lt(NotificationsModel.createdAt, after.createdAt),
        and(
          eq(NotificationsModel.createdAt, after.createdAt),
          lt(NotificationsModel.id, after.id)
        )
      )!
    );
  }

  // One extra row answers "is there a next page" without a second count query.
  const rows = await database
    .select()
    .from(NotificationsModel)
    .where(and(...filters))
    .orderBy(desc(NotificationsModel.createdAt), desc(NotificationsModel.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && items.length ? encodeCursor(items[items.length - 1]) : null,
  };
}

/**
 * Counts for the tab bar.
 *
 * `total` and `byCategory` count unread — "what have I not looked at". But
 * `actionRequired` counts *unresolved*, which is a different question:
 * outstanding work, whether or not anyone has glanced at the row. Counting it
 * as unread made the badge wrong in both directions — a receptionist who
 * opened a row to see what it was cleared it without doing the work, while one
 * who did the work from the queue screen left it counted forever.
 *
 * That means the two are not summable: an unresolved row that has been read
 * counts toward `actionRequired` but not `total`. Deliberate — they answer
 * different questions and the tab bar shows them separately.
 */
export async function getUnreadBreakdown(userId: string) {
  const [unreadRows, actionRows] = await Promise.all([
    database
      .select({
        category: NotificationsModel.category,
        total: count(),
      })
      .from(NotificationsModel)
      .where(
        and(
          eq(NotificationsModel.userId, userId),
          eq(NotificationsModel.read, false),
          eq(NotificationsModel.kind, 'notification')
        )
      )
      .groupBy(NotificationsModel.category),

    // Served by notifications_user_unresolved_idx.
    database
      .select({ total: count() })
      .from(NotificationsModel)
      .where(
        and(
          eq(NotificationsModel.userId, userId),
          eq(NotificationsModel.kind, 'notification'),
          eq(NotificationsModel.priority, 'action_required'),
          isNull(NotificationsModel.resolvedAt)
        )
      ),
  ]);

  const byCategory: Record<string, number> = {};
  let total = 0;

  for (const row of unreadRows) {
    const n = Number(row.total);
    byCategory[row.category] = (byCategory[row.category] ?? 0) + n;
    total += n;
  }

  return {
    total,
    actionRequired: Number(actionRows[0]?.total ?? 0),
    byCategory,
  };
}

/**
 * Mark a set of the caller's notifications read.
 *
 * Scoped by userId in the WHERE clause, not by trusting the ids: without it,
 * anyone holding a notification id could mark someone else's row read.
 */
export async function markManyRead(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return database
    .update(NotificationsModel)
    .set({ read: true })
    .where(
      and(
        eq(NotificationsModel.userId, userId),
        inArray(NotificationsModel.id, ids)
      )
    )
    .returning({ id: NotificationsModel.id });
}

/**
 * List all notifications for a user (read + unread)
 */
export async function listNotificationsForUser(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
) {
  const q = database
    .select()
    .from(NotificationsModel)
    .where(eq(NotificationsModel.userId, userId))
    .orderBy(desc(NotificationsModel.createdAt))
    .limit(opts.limit ?? 50);

  if (opts.offset) q.offset(opts.offset);
  const rows = await q;
  return rows;
}

/**
 * List ONLY unread notifications for a user
 */
export async function listUnreadNotificationsForUser(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
) {
  const q = database
    .select()
    .from(NotificationsModel)
    .where(
      and(
        eq(NotificationsModel.userId, userId),
        eq(NotificationsModel.read, false)
      )
    )
    .orderBy(desc(NotificationsModel.createdAt))
    .limit(opts.limit ?? 100);

  if (opts.offset) q.offset(opts.offset);
  const rows = await q;
  return rows;
}

/**
 * Get unread count for a user
 */
/** Badge count, bounded at UNREAD_COUNT_CAP — an exact count over a large
 *  backlog costs a full scan to render "99+". */
export const UNREAD_COUNT_CAP = 100;

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await database
    .select({ id: NotificationsModel.id })
    .from(NotificationsModel)
    .where(
      and(
        eq(NotificationsModel.userId, userId),
        eq(NotificationsModel.read, false),
        eq(NotificationsModel.kind, 'notification')
      )
    )
    .limit(UNREAD_COUNT_CAP);

  return rows.length;
}

/**
 * Delete a single notification
 */
// Scoped by userId for the same reason as markNotificationRead.
export async function deleteNotification(
  userId: string,
  notificationId: string
) {
  const res = await database
    .delete(NotificationsModel)
    .where(
      and(
        eq(NotificationsModel.id, notificationId),
        eq(NotificationsModel.userId, userId)
      )
    )
    .returning();
  return res[0];
}

/**
 * Delete all notifications for a user
 */
export async function deleteAllNotificationsForUser(userId: string) {
  // Ids only — the caller reports a count, and a full return pulls back every
  // row it just deleted.
  const res = await database
    .delete(NotificationsModel)
    .where(eq(NotificationsModel.userId, userId))
    .returning({ id: NotificationsModel.id });
  return res;
}
