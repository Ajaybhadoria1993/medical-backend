import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  jsonb,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { UserModel } from '../../users/models/user.model';

/** Which tab a notification belongs to in the Notification Center. */
export const notificationCategoryEnum = pgEnum('notification_category', [
  'appointments',
  'payments',
  'prescription',
  'lab',
  'staff',
  'system',
]);

export const notificationPriorityEnum = pgEnum('notification_priority', [
  'action_required',
  'normal',
  'low',
]);

/** Notification interrupts (bell, badge, push); activity only records. */
export const notificationKindEnum = pgEnum('notification_kind', [
  'notification',
  'activity',
]);

/**
 * A (type, id) pair rather than a bare clinic_id: lab and pharmacy are planned
 * to separate, and renaming a column on a large table mid-separation costs more
 * than carrying the type. No FK by design (A5). NOT a security boundary —
 * access control stays on user_id.
 */
export const notificationTenantTypeEnum = pgEnum('notification_tenant_type', [
  'clinic',
  'lab',
  'pharmacy',
]);

export const NotificationsModel = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 120 }).notNull(), // e.g. 'message', 'system', 'appointment'
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'), // arbitrary JSON payload
    read: boolean('read').notNull().default(false),

    /**
     * When the work this notification asks for was actually done — the payment
     * taken, the follow-up booked — and by whom.
     *
     * Deliberately separate from `read`, which only records that someone
     * opened the row. The two answer different questions and diverge in both
     * directions: a receptionist who clicks a row to see what it is has read
     * it without doing anything, and one who takes the payment from the queue
     * screen has done the work without ever opening the notification. With
     * only `read` to go on, the Action Required tab counted the first as
     * handled and the second as outstanding, so its badge was wrong both ways.
     *
     * Only meaningful where priority = 'action_required'; null everywhere else.
     * `resolvedBy` because a clinic's desk is shared — when something is
     * missed, who cleared it is the first question asked.
     */
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => UserModel.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    metadata: jsonb('metadata'), // optional meta (source, severity, etc)

    /**
     * Both null is valid — platform-level events belong to no tenant, so never
     * make these NOT NULL. Not the security boundary: that stays user_id.
     */
    tenantType: notificationTenantTypeEnum('tenant_type'),
    tenantId: uuid('tenant_id'),

    category: notificationCategoryEnum('category').notNull().default('system'),
    priority: notificationPriorityEnum('priority').notNull().default('normal'),
    kind: notificationKindEnum('kind').notNull().default('notification'),

    /**
     * Registry event key, e.g. 'appointment.created'. Replaces the old
     * metadata->>'action': a JSONB extraction cannot be btree-indexed or
     * constrained, and every preference check and category filter reads this.
     */
    eventKey: varchar('event_key', { length: 120 }),

    /**
     * Where clicking the notification goes, resolved server-side so the client
     * never carries a routing switch that can drift from the backend.
     */
    clickRoute: varchar('click_route', { length: 255 }),
    clickParams: jsonb('click_params'),

    /**
     * Spam collapse. Re-firing the same event for the same recipient updates the
     * existing unread row instead of appending a new one — one appointment
     * producing five state changes yields one inbox entry, not five.
     */
    collapseKey: varchar('collapse_key', { length: 200 }),
  },
  (table) => [
    index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt.desc()
    ),
    index('notifications_user_unread_idx')
      .on(table.userId, table.createdAt.desc())
      .where(sql`${table.read} = false`),

    // What the Action Required tab actually asks: outstanding work, not
    // unread rows. Partial, because resolved and non-action rows are the vast
    // majority and never appear in this query.
    index('notifications_user_unresolved_idx')
      .on(table.userId, table.createdAt.desc())
      .where(
        sql`${table.priority} = 'action_required' AND ${table.resolvedAt} IS NULL`
      ),

    // The Notification vs Activity split: every inbox query filters on kind.
    index('notifications_user_kind_created_idx').on(
      table.userId,
      table.kind,
      table.createdAt.desc()
    ),

    // Per-tenant retention and superadmin lookups.
    index('notifications_tenant_created_idx').on(
      table.tenantType,
      table.tenantId,
      table.createdAt.desc()
    ),

    // At most one unread row per (user, collapse key). Enforced in the database
    // so a concurrent fan-out cannot race two rows into existence.
    uniqueIndex('notifications_user_collapse_unread_uq')
      .on(table.userId, table.collapseKey)
      .where(sql`${table.read} = false AND ${table.collapseKey} IS NOT NULL`),

    // Both tenant columns set, or neither. Guards the genuinely broken states
    // (a type with no id, an id with no type) while leaving the platform-level
    // null/null case legal.
    check(
      'notifications_tenant_pair_ck',
      sql`(${table.tenantType} IS NULL) = (${table.tenantId} IS NULL)`
    ),
  ]
);
