import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import type { PlanSnapshot, StepOption } from '../types/plan.types';
import type { SpecialtyData } from '../types/specialty.types';
import {
  tpBillingModeEnum,
  tpPlanStatusEnum,
  tpPlanTypeEnum,
  tpStepStatusEnum,
} from './treatmentEnums.model';
import { TreatmentTemplateModel } from './treatmentTemplate.model';

export type TreatmentPlan = InferSelectModel<typeof TreatmentPlanModel>;
export type NewTreatmentPlan = InferInsertModel<typeof TreatmentPlanModel>;
export type TreatmentPlanVersion = InferSelectModel<
  typeof TreatmentPlanVersionModel
>;
export type TreatmentPlanStep = InferSelectModel<typeof TreatmentPlanStepModel>;
export type NewTreatmentPlanStep = InferInsertModel<
  typeof TreatmentPlanStepModel
>;
export type TreatmentStepAppointment = InferSelectModel<
  typeof TreatmentStepAppointmentModel
>;

/** One patient's plan. Patient, doctor and appointment ids are plain uuids (module boundary).
 *  The current version is read from treatment_plan_versions, not stored here. */
export const TreatmentPlanModel = pgTable(
  'treatment_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    /** Null = custom plan. */
    templateId: uuid('template_id').references(() => TreatmentTemplateModel.id),
    /** Its report card holds the diagnosis, so no report-card id is stored. */
    consultationAppointmentId: uuid('consultation_appointment_id'),
    /** Options A and B share it; accepting one declines the others. */
    proposalGroupId: uuid('proposal_group_id').notNull(),
    optionLabel: varchar('option_label', { length: 10 }),
    /** Which step the consultation visit (consultation_appointment_id) counts as, linked on accept; null = none. */
    consultationStepSeq: integer('consultation_step_seq'),
    /** What makes this option different, e.g. "Ceramic crown"; required once a proposal has 2+ options. */
    optionName: varchar('option_name', { length: 60 }),
    title: varchar('title', { length: 150 }).notNull(),
    diagnosis: text('diagnosis').notNull(),
    planType: tpPlanTypeEnum('plan_type').notNull(),
    status: tpPlanStatusEnum('status').default('proposed').notNull(),
    /** Chosen on accept. */
    billingMode: tpBillingModeEnum('billing_mode'),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 })
      .default('0')
      .notNull(),
    /** The agreed price; the steps' fee sum is calculated, not stored. */
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
    advanceAmount: decimal('advance_amount', { precision: 12, scale: 2 })
      .default('0')
      .notNull(),
    /** Plain S3 key, never a signed link. */
    consentFileUrl: text('consent_file_url'),
    /** Consent is given in the accept action, so this is also the consent time. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    followUpDate: date('follow_up_date'),
    endReason: varchar('end_reason', { length: 255 }),
    /** True stops every message for the plan. */
    endReasonSensitive: boolean('end_reason_sensitive')
      .default(false)
      .notNull(),
    recallDate: date('recall_date'),
    /** Copied from the template; on completion sets recall_date unless staff already set one. */
    recallAfterDays: integer('recall_after_days'),
    /** Copied from the template so a later template edit never changes this plan's rule. */
    consentRequired: boolean('consent_required').notNull(),
    /** Copied from the template; a custom or older plan may always be paid in instalments. */
    instalmentsAllowed: boolean('instalments_allowed').default(true).notNull(),
    /** Copied from the template; the accept date plus this sets package_expires_on. */
    packageExpiryDays: integer('package_expiry_days'),
    packageExpiresOn: date('package_expires_on'),
    specialtyData: jsonb('specialty_data')
      .$type<SpecialtyData>()
      .default({})
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Optimistic concurrency: edits update `where updated_at = <value read>`. */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('treatment_plans_clinic_status_idx').on(table.clinicId, table.status),
    index('treatment_plans_clinic_doctor_idx').on(
      table.clinicId,
      table.doctorId,
      table.status
    ),
    index('treatment_plans_clinic_patient_idx').on(
      table.clinicId,
      table.patientId
    ),
    index('treatment_plans_follow_up_idx').on(
      table.clinicId,
      table.followUpDate
    ),
    index('treatment_plans_recall_idx').on(table.clinicId, table.recallDate),
    // Accept locks the whole proposal group FOR UPDATE.
    index('treatment_plans_proposal_group_idx').on(table.proposalGroupId),
    check(
      'treatment_plans_amounts_ck',
      sql`${table.totalAmount} >= 0 AND ${table.discountAmount} >= 0 AND ${table.advanceAmount} >= 0`
    ),
  ]
);

/** Immutable snapshot each time an accepted plan changes. */
export const TreatmentPlanVersionModel = pgTable(
  'treatment_plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    planId: uuid('plan_id')
      .references(() => TreatmentPlanModel.id)
      .notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<PlanSnapshot>().notNull(),
    changeReason: varchar('change_reason', { length: 255 }),
    /** True when cost or steps changed. */
    needsPatientApproval: boolean('needs_patient_approval')
      .default(false)
      .notNull(),
    patientApprovedAt: timestamp('patient_approved_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('treatment_plan_versions_uq').on(table.planId, table.version),
  ]
);

/** One row per step; a package plan gets one row per session. */
export const TreatmentPlanStepModel = pgTable(
  'treatment_plan_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    planId: uuid('plan_id')
      .references(() => TreatmentPlanModel.id)
      .notNull(),
    seq: integer('seq').notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    gapDays: integer('gap_days').notNull(),
    /** Copied from the template's "late after": a visit later than this many days after the step before is late. */
    maxGapDays: integer('max_gap_days'),
    /** Null = the doctor's normal slot length. */
    durationMinutes: integer('duration_minutes'),
    fee: decimal('fee', { precision: 12, scale: 2 }).notNull(),
    selectedOption: jsonb('selected_option').$type<StepOption>(),
    specialtyData: jsonb('specialty_data')
      .$type<SpecialtyData>()
      .default({})
      .notNull(),
    status: tpStepStatusEnum('status').default('pending').notNull(),
    /** IST day; recalculated on every booking, move and miss (DEV_PLAN §5). */
    earliestDate: date('earliest_date'),
    /** Set when a booking goes under the gap. */
    gapOverrideReason: varchar('gap_override_reason', { length: 255 }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneAppointmentId: uuid('done_appointment_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Reorder adds 1000 to every seq first, so this never clashes mid-transaction.
    uniqueIndex('treatment_plan_steps_seq_uq').on(table.planId, table.seq),
    index('treatment_plan_steps_need_booking_idx')
      .on(table.clinicId, table.earliestDate)
      .where(sql`${table.status} = 'pending'`),
    check(
      'treatment_plan_steps_values_ck',
      sql`${table.seq} >= 1 AND ${table.gapDays} >= 0
        AND (${table.durationMinutes} IS NULL OR ${table.durationMinutes} > 0)
        AND ${table.fee} >= 0`
    ),
  ]
);

/** Step ↔ appointment link: one visit can cover two plans' steps, one step can need two visits. */
export const TreatmentStepAppointmentModel = pgTable(
  'treatment_step_appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    stepId: uuid('step_id')
      .references(() => TreatmentPlanStepModel.id)
      .notNull(),
    /** Denormalised for list queries. */
    planId: uuid('plan_id')
      .references(() => TreatmentPlanModel.id)
      .notNull(),
    appointmentId: uuid('appointment_id').notNull(),
    linkedBy: uuid('linked_by').notNull(),
    /** A normal visit the plan now pays for: what it was, so unlinking gives it back (never cancels it).
     *  All null for a visit booked from the plan. */
    coveredType: varchar('covered_type', { length: 50 }),
    coveredPrice: decimal('covered_price', { precision: 12, scale: 2 }),
    coveredPrimaryPrice: decimal('covered_primary_price', {
      precision: 12,
      scale: 2,
    }),
    coveredPaymentMode: varchar('covered_payment_mode', { length: 50 }),
    /** Unlink keeps the row; the step goes back to "not booked". */
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Partial, so a link removed by mistake can be made again.
    uniqueIndex('treatment_step_appointments_live_uq')
      .on(table.stepId, table.appointmentId)
      .where(sql`${table.unlinkedAt} IS NULL`),
    index('treatment_step_appointments_appt_idx').on(table.appointmentId),
  ]
);
