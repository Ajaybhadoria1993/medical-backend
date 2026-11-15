import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export type AuditLog = InferSelectModel<typeof AuditLogModel>;
export type NewAuditLog = InferInsertModel<typeof AuditLogModel>;

/** Append-only record of which staff member did which tracked action, and when.
 *  Holds ids only, never request data; no FKs so history outlives deleted users. */
export const AuditLogModel = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** A key from TRACKED_ACTIONS, e.g. `appointment.cancelled`. */
    action: varchar('action', { length: 64 }).notNull(),
    /** The record acted on, when the request names one. */
    entityId: varchar('entity_id', { length: 64 }),
    ip: varchar('ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clinicCreatedIdx: index('audit_log_clinic_created_idx').on(
      table.clinicId,
      table.createdAt
    ),
    // Serves the nightly retention purge, which has no clinic to filter on.
    createdIdx: index('audit_log_created_idx').on(table.createdAt),
  })
);
