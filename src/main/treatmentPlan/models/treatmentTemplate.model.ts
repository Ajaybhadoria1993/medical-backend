import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { StepOption } from '../types/plan.types';
import {
  tpPlanTypeEnum,
  tpPricingModeEnum,
  tpTemplateStatusEnum,
} from './treatmentEnums.model';

export type TreatmentTemplate = InferSelectModel<typeof TreatmentTemplateModel>;
export type NewTreatmentTemplate = InferInsertModel<
  typeof TreatmentTemplateModel
>;
export type TreatmentTemplateStep = InferSelectModel<
  typeof TreatmentTemplateStepModel
>;
export type NewTreatmentTemplateStep = InferInsertModel<
  typeof TreatmentTemplateStepModel
>;

/** Library row (clinic_id null), clinic copy, or a doctor's own version. Edited in place:
 *  plans copy the steps and fees they use. No FK to clinics/users (module boundary). */
export const TreatmentTemplateModel = pgTable(
  'treatment_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id'),
    ownerDoctorId: uuid('owner_doctor_id'),
    sourceTemplateId: uuid('source_template_id'),
    /** Stable library key, e.g. `dental.root_canal`; the seed inserts only when missing. */
    code: varchar('code', { length: 64 }),
    name: varchar('name', { length: 150 }).notNull(),
    specialty: varchar('specialty', { length: 100 }).notNull(),
    planType: tpPlanTypeEnum('plan_type').notNull(),
    status: tpTemplateStatusEnum('status').default('draft').notNull(),
    pricingMode: tpPricingModeEnum('pricing_mode').notNull(),
    packagePrice: decimal('package_price', { precision: 12, scale: 2 }),
    sessionCount: integer('session_count'),
    intervalDays: integer('interval_days'),
    packageExpiryDays: integer('package_expiry_days'),
    consentRequired: boolean('consent_required').default(false).notNull(),
    /** GST is an open item: stored, not applied yet. */
    taxable: boolean('taxable').default(false).notNull(),
    instalmentsAllowed: boolean('instalments_allowed').default(false).notNull(),
    recallAfterDays: integer('recall_after_days'),
    diagnosisKeywords: text('diagnosis_keywords')
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    checkedBy: uuid('checked_by'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /** Null only on seeded library templates. */
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Partial: a plain unique treats the library's null clinic_id values as distinct.
    uniqueIndex('treatment_templates_library_code_uq')
      .on(table.code)
      .where(sql`${table.clinicId} IS NULL`),
    index('treatment_templates_clinic_status_idx').on(
      table.clinicId,
      table.status,
      table.specialty
    ),
    index('treatment_templates_keywords_gin').using(
      'gin',
      table.diagnosisKeywords
    ),
    index('treatment_templates_name_trgm').using(
      'gin',
      table.name.op('gin_trgm_ops')
    ),
    check(
      'treatment_templates_package_ck',
      sql`${table.planType} <> 'package' OR (${table.sessionCount} >= 1 AND ${table.intervalDays} >= 1)`
    ),
    check(
      'treatment_templates_review_ck',
      sql`${table.planType} <> 'review' OR (${table.sessionCount} >= 1 AND ${table.intervalDays} >= 1)`
    ),
  ]
);

/** Staged templates only; a package template's sessions are generated. */
export const TreatmentTemplateStepModel = pgTable(
  'treatment_template_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id'),
    templateId: uuid('template_id')
      .references(() => TreatmentTemplateModel.id, { onDelete: 'cascade' })
      .notNull(),
    seq: integer('seq').notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    /** Minimum days after the previous step. */
    gapDays: integer('gap_days').notNull(),
    /** Reminder only, never blocks a booking. */
    maxGapDays: integer('max_gap_days'),
    /** Null = the doctor's normal slot length. */
    durationMinutes: integer('duration_minutes'),
    fee: decimal('fee', { precision: 12, scale: 2 }),
    options: jsonb('options').$type<StepOption[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('treatment_template_steps_seq_uq').on(
      table.templateId,
      table.seq
    ),
    check(
      'treatment_template_steps_values_ck',
      sql`${table.seq} >= 1 AND ${table.gapDays} >= 0
        AND (${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0)
        AND (${table.fee} IS NULL OR ${table.fee} >= 0)`
    ),
  ]
);
