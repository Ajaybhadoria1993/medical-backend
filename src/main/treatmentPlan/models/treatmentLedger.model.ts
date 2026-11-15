import { sql, type InferSelectModel } from 'drizzle-orm';
import {
  check,
  date,
  decimal,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TreatmentPlanModel } from './treatmentPlan.model';

export type TreatmentInstalment = InferSelectModel<
  typeof TreatmentInstalmentModel
>;

/** A plan's payment schedule (the money itself is in money_entries, source treatment_plan).
 *  Unpaid rows re-balance when a new version changes the total; paid rows never change. */
export const TreatmentInstalmentModel = pgTable(
  'treatment_instalments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    planId: uuid('plan_id')
      .references(() => TreatmentPlanModel.id)
      .notNull(),
    seq: integer('seq').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('treatment_instalments_seq_uq').on(table.planId, table.seq),
    index('treatment_instalments_due_idx')
      .on(table.dueDate)
      .where(sql`${table.paidAt} IS NULL`),
    check('treatment_instalments_amount_ck', sql`${table.amount} > 0`),
  ]
);
