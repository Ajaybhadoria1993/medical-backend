// src/main/subscription/models/clinicUsage.model.ts
import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Clinic Usage Tracking Model
 *
 * Tracks monthly usage of limited features per clinic.
 * Resets each billing period (month).
 *
 * Feature Keys tracked:
 * - whatsapp_messages_per_month → count of messages sent this period
 */
export const ClinicUsageModel = pgTable(
  'clinic_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id').notNull(),

    /** Feature key matching PlanLimitsModel.featureKey */
    featureKey: varchar('feature_key', { length: 100 }).notNull(),

    /** Current usage count for this period */
    usageCount: integer('usage_count').default(0).notNull(),

    /** Period start (first day of the month or billing cycle start) */
    periodStart: timestamp('period_start').notNull(),

    /** Period end (last day of the month or billing cycle end) */
    periodEnd: timestamp('period_end').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('clinic_usage_unique').on(
      table.clinicId,
      table.featureKey,
      table.periodStart
    ),
    index('clinic_usage_clinic_idx').on(table.clinicId),
    index('clinic_usage_period_idx').on(table.periodStart, table.periodEnd),
  ]
);
