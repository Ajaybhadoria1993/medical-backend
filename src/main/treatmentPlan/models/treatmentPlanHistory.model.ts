import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { HistoryAction, HistoryMeta } from '../types/history.types';
import { TreatmentPlanModel } from './treatmentPlan.model';
import { TreatmentTemplateModel } from './treatmentTemplate.model';

export type TreatmentPlanHistory = InferSelectModel<
  typeof TreatmentPlanHistoryModel
>;
export type NewTreatmentPlanHistory = InferInsertModel<
  typeof TreatmentPlanHistoryModel
>;

/** The plan's (or template's) own record of what happened and why; audit_log covers who did it.
 *  A follow-up call is a row too (action follow_up_call). */
export const TreatmentPlanHistoryModel = pgTable(
  'treatment_plan_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id'),
    planId: uuid('plan_id').references(() => TreatmentPlanModel.id),
    templateId: uuid('template_id').references(() => TreatmentTemplateModel.id),
    /** Null for system events, e.g. a step missed through the appointment hook. */
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 64 }).$type<HistoryAction>().notNull(),
    fromValue: varchar('from_value', { length: 100 }),
    toValue: varchar('to_value', { length: 100 }),
    reason: varchar('reason', { length: 255 }),
    notes: text('notes'),
    meta: jsonb('meta').$type<HistoryMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('treatment_plan_history_plan_idx').on(
      table.planId,
      table.action,
      table.createdAt
    ),
    index('treatment_plan_history_template_idx').on(
      table.templateId,
      table.createdAt
    ),
    check(
      'treatment_plan_history_owner_ck',
      sql`(${table.planId} IS NULL) <> (${table.templateId} IS NULL)`
    ),
  ]
);
