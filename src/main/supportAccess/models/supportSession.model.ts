import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export type SupportSession = InferSelectModel<typeof SupportSessionsModel>;
export type NewSupportSession = InferInsertModel<typeof SupportSessionsModel>;

/** One Super Admin "View as" session: read-only, masked, time-boxed.
 *  No FK to users/clinics (module boundary), so history outlives a deleted clinic. */
export const SupportSessionsModel = pgTable(
  'support_access_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    superAdminId: uuid('super_admin_id').notNull(),
    targetUserId: uuid('target_user_id').notNull(),
    clinicId: uuid('clinic_id').notNull(),
    targetRole: varchar('target_role', { length: 30 }).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** 'exit', 'replaced' (a newer session started) or 'end_all'; null while open or after expiry. */
    endReason: varchar('end_reason', { length: 20 }),
  },
  (t) => [
    index('support_sessions_clinic_idx').on(t.clinicId, t.startedAt),
    index('support_sessions_admin_idx').on(t.superAdminId, t.endedAt),
  ]
);

/** Each screen (GET path) opened during a session. */
export const SupportSessionViewsModel = pgTable(
  'support_access_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull(),
    path: varchar('path', { length: 255 }).notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('support_views_session_idx').on(t.sessionId, t.viewedAt)]
);
