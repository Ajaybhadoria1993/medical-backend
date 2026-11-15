import { sql } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  CommissionPeriodKind,
  CommissionTier,
} from '../types/patientCommission.types';

export type CommissionPricingRow = InferSelectModel<
  typeof CommissionPricingModel
>;
export type NewCommissionPricingRow = InferInsertModel<
  typeof CommissionPricingModel
>;

/** Versioned per-patient pricing: clinic_id null is the platform default and a change adds a row.
 *  A clinic row with null tiers and period_kind means "follow the platform default". */
export const CommissionPricingModel = pgTable(
  'commission_pricing_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** No foreign key: the module keeps only the clinic's id. */
    clinicId: uuid('clinic_id'),
    periodKind: varchar('period_kind', { length: 20 }).$type<CommissionPeriodKind>(),
    tiers: jsonb('tiers').$type<CommissionTier[]>(),
    /** IST midnight of the first day of a period; changes always start on a period boundary. */
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    changedBy: uuid('changed_by').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('commission_pricing_clinic_from_unique')
      .on(table.clinicId, table.effectiveFrom)
      .where(sql`${table.clinicId} is not null`),
    uniqueIndex('commission_pricing_default_from_unique')
      .on(table.effectiveFrom)
      .where(sql`${table.clinicId} is null`),
  ]
);
