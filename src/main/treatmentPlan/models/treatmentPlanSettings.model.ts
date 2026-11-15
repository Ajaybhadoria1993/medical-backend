import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { FieldDef } from '../types/specialty.types';
import { tpBillingModeEnum, tpBookingModeEnum } from './treatmentEnums.model';

export type TreatmentPlanSettings = InferSelectModel<
  typeof TreatmentPlanSettingsModel
>;
export type NewTreatmentPlanSettings = InferInsertModel<
  typeof TreatmentPlanSettingsModel
>;
export type TreatmentSpecialtyConfig = InferSelectModel<
  typeof TreatmentSpecialtyConfigModel
>;

/** One row per clinic, created with these defaults on first read; clinic_settings stays untouched. */
export const TreatmentPlanSettingsModel = pgTable(
  'treatment_plan_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    billingModes: tpBillingModeEnum('billing_modes')
      .array()
      .default(
        sql`ARRAY['per_visit','advance_per_visit','package_full','package_instalments']::tp_billing_mode[]`
      )
      .notNull(),
    invoiceTiming: varchar('invoice_timing', { length: 10 })
      .$type<'per_step' | 'at_end'>()
      .default('per_step')
      .notNull(),
    /** A discount above this needs Admin or Doctor approval. */
    discountCapPercent: integer('discount_cap_percent').default(10).notNull(),
    bookingMode: tpBookingModeEnum('booking_mode').default('normal').notNull(),
    bookingHorizonDays: integer('booking_horizon_days'),
    recallReminderDays: integer('recall_reminder_days').default(7).notNull(),
    instalmentReminderDays: integer('instalment_reminder_days')
      .default(2)
      .notNull(),
    packageExpiryReminderDays: integer('package_expiry_reminder_days')
      .default(7)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('treatment_plan_settings_clinic_uq').on(table.clinicId),
    check(
      'treatment_plan_settings_values_ck',
      sql`${table.discountCapPercent} BETWEEN 0 AND 100
        AND ${table.invoiceTiming} IN ('per_step', 'at_end')`
    ),
  ]
);

/** Extra fields per specialty; adding a specialty is a row here, not a code change.
 *  clinic_id null = platform default set by Super Admin. */
export const TreatmentSpecialtyConfigModel = pgTable(
  'treatment_specialty_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id'),
    specialty: varchar('specialty', { length: 100 }).notNull(),
    planFields: jsonb('plan_fields').$type<FieldDef[]>().default([]).notNull(),
    stepFields: jsonb('step_fields').$type<FieldDef[]>().default([]).notNull(),
    /** UI-only widget name, e.g. `tooth_chart`. */
    widget: varchar('widget', { length: 50 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Two partial indexes: a plain unique treats null clinic_id values as distinct.
    uniqueIndex('treatment_specialty_configs_platform_uq')
      .on(table.specialty)
      .where(sql`${table.clinicId} IS NULL`),
    uniqueIndex('treatment_specialty_configs_clinic_uq')
      .on(table.clinicId, table.specialty)
      .where(sql`${table.clinicId} IS NOT NULL`),
  ]
);
