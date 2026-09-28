import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  decimal,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { sql } from 'drizzle-orm';

// 1. Application-Level Cancellation Policy Governance
export const ApplicationCancellationPolicyModel = pgTable(
  'application_cancellation_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cancellationFeatureEnabled: boolean('cancellation_feature_enabled')
      .default(true)
      .notNull(),
    refundFeatureEnabled: boolean('refund_feature_enabled')
      .default(true)
      .notNull(),
    rescheduleFeatureEnabled: boolean('reschedule_feature_enabled')
      .default(true)
      .notNull(),
    policyPrecedence: varchar('policy_precedence', { length: 50 })
      .default('Application > Clinic')
      .notNull(),
    allowClinicConfiguration: boolean('allow_clinic_configuration')
      .default(true)
      .notNull(),
    defaultRefundPercentage: integer('default_refund_percentage')
      .default(100)
      .notNull(),
    defaultRefundCooldownHours: integer('default_refund_cooldown_hours')
      .default(24)
      .notNull(),
    partialRefundCooldownHours: integer('partial_refund_cooldown_hours')
      .default(12)
      .notNull(),
    partialRefundPercentage: integer('partial_refund_percentage')
      .default(50)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
);

// 2. Clinic-Specific Policy Settings (with simple versioning support)
export const ClinicCancellationPolicyModel = pgTable(
  'clinic_cancellation_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),

    // Cancellation Rights (Roles Allowed to Cancel)
    allowPatientCancel: boolean('allow_patient_cancel').default(true).notNull(),
    allowDoctorCancel: boolean('allow_doctor_cancel').default(true).notNull(),
    allowReceptionistCancel: boolean('allow_receptionist_cancel')
      .default(true)
      .notNull(),
    allowClinicAdminCancel: boolean('allow_clinic_admin_cancel')
      .default(true)
      .notNull(),

    // Cancellation Windows (Hours before appointment)
    windowOnlineHours: integer('window_online_hours').default(24).notNull(),
    windowOfflineHours: integer('window_offline_hours').default(12).notNull(),

    // Cancellation Limits per patient
    dailyLimitPerPatient: integer('daily_limit_per_patient')
      .default(3)
      .notNull(),
    weeklyLimitPerPatient: integer('weekly_limit_per_patient')
      .default(10)
      .notNull(),
    monthlyLimitPerPatient: integer('monthly_limit_per_patient')
      .default(30)
      .notNull(),
    cooldownSecondsBetweenCancellations: integer(
      'cooldown_seconds_between_cancellations'
    )
      .default(1800)
      .notNull(), // 30 minutes default cooldown

    // Comments / Validations
    reasonMandatory: boolean('reason_mandatory').default(true).notNull(),
    allowAdditionalComments: boolean('allow_additional_comments')
      .default(true)
      .notNull(),
    minCommentLength: integer('min_comment_length').default(0).notNull(),
    maxCommentLength: integer('max_comment_length').default(500).notNull(),

    // Cancellation-to-Reschedule Rules
    allowReschedule: boolean('allow_reschedule').default(true).notNull(),
    maxReschedules: integer('max_reschedules').default(3).notNull(),
    rescheduleWindowHours: integer('reschedule_window_hours')
      .default(24)
      .notNull(), // Must reschedule at least 24h prior
    preservePaymentOnReschedule: boolean('preserve_payment_on_reschedule')
      .default(true)
      .notNull(),

    // Governance & Versioning
    version: integer('version').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    deactivatedAt: timestamp('deactivated_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // Ensure only one active policy version per clinic
    uniqueIndex('ux_clinic_active_policy')
      .on(table.clinicId)
      .where(sql`is_active = true`),
  ]
);

// 3. Cancellation Requests tracking
export const CancellationRequestModel = pgTable('cancellation_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .references(() => AppointmentModel.id, { onDelete: 'cascade' })
    .notNull(),
  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id)
    .notNull(),
  userId: uuid('user_id')
    .references(() => UserModel.id)
    .notNull(), // User who initiated cancellation
  userRole: varchar('user_role', { length: 50 }).notNull(), // 'Patient', 'Doctor', 'Receptionist', 'Clinic_Admin', etc.
  reasonCode: varchar('reason_code', { length: 50 }).notNull(), // validated against static reason codes
  comments: varchar('comments', { length: 500 }),
  isRescheduleRequest: boolean('is_reschedule_request')
    .default(false)
    .notNull(),
  status: varchar('status', { length: 50 }).default('Approved').notNull(), // 'Approved', 'PendingApproval', 'Rejected'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Cancellation Refunds tracking
export const CancellationRefundModel = pgTable('cancellation_refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  cancellationRequestId: uuid('cancellation_request_id')
    .references(() => CancellationRequestModel.id, { onDelete: 'cascade' })
    .notNull(),
  appointmentId: uuid('appointment_id')
    .references(() => AppointmentModel.id, { onDelete: 'cascade' })
    .notNull(),
  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id)
    .notNull(),
  paymentId: uuid('payment_id')
    .references(() => AppointmentPaymentModel.id)
    .notNull(),
  refundType: varchar('refund_type', { length: 50 }).notNull(), // 'Full', 'Partial', 'None'
  originalPrice: decimal('original_price', {
    precision: 12,
    scale: 2,
  }).notNull(),
  refundAmount: decimal('refund_amount', { precision: 12, scale: 2 }).notNull(),
  refundStatus: varchar('refund_status', { length: 50 })
    .default('Pending')
    .notNull(), // 'Pending', 'Processing', 'Completed', 'Failed'
  gatewayRefundId: varchar('gateway_refund_id', { length: 255 }), // Razorpay refund ID
  gatewayResponse: jsonb('gateway_response'),
  failureReason: varchar('failure_reason', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 5. Cancellation Audits
export const CancellationAuditModel = pgTable('cancellation_audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 100 }).notNull(), // 'PolicyUpdate', 'PolicyOverride', 'ValidationError', etc.
  clinicId: uuid('clinic_id').references(() => ClinicModel.id, {
    onDelete: 'set null',
  }),
  userId: uuid('user_id').references(() => UserModel.id, {
    onDelete: 'set null',
  }),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
