import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';

export type FollowupTask = InferSelectModel<typeof FollowupTaskModel>;
export type NewFollowupTask = InferInsertModel<typeof FollowupTaskModel>;
export type FollowupNote = InferSelectModel<typeof FollowupNoteModel>;
export type NewFollowupNote = InferInsertModel<typeof FollowupNoteModel>;

/** The Super Admin team's to-do list about clinics; opened and auto-closed by the nightly rules.
 *  No FK to clinics/users (module boundary), so a task outlives a deleted clinic. */
export const FollowupTaskModel = pgTable(
  'followup_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    /** A FOLLOWUP_TYPES key, e.g. `dormant`. Plain varchar so a new rule needs no migration. */
    type: varchar('type', { length: 32 }).notNull(),
    priority: varchar('priority', { length: 8 }).notNull(),
    /** open | snoozed | resolved */
    status: varchar('status', { length: 16 }).default('open').notNull(),
    ownerAdminId: uuid('owner_admin_id'),
    reason: varchar('reason', { length: 255 }).notNull(),
    /** The counts that fired the rule (days idle, appointment counts); never patient data. */
    triggerData: jsonb('trigger_data'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    /** Set once someone logs a contact; drives the "Contacted" column. */
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Null when the rules closed it because the problem went away. */
    resolvedBy: uuid('resolved_by'),
    /** A FOLLOWUP_OUTCOMES key, e.g. `recovered` or `auto_cleared`. */
    outcome: varchar('outcome', { length: 32 }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One live task per clinic per problem, so a rerun of the rules can't duplicate it.
    uniqueIndex('followup_tasks_live_unique')
      .on(table.clinicId, table.type)
      .where(sql`status <> 'resolved'`),
    index('followup_tasks_status_opened_idx').on(table.status, table.openedAt),
    index('followup_tasks_clinic_idx').on(table.clinicId),
  ]
);

/** Append-only history under a task: notes, status changes, assignments, rule events. */
export const FollowupNoteModel = pgTable(
  'followup_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .references(() => FollowupTaskModel.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for entries the nightly rules wrote. */
    authorId: uuid('author_id'),
    /** note | contacted | message | status_change | assigned | auto */
    kind: varchar('kind', { length: 16 }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('followup_notes_task_created_idx').on(table.taskId, table.createdAt),
  ]
);
