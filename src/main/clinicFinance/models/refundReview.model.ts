import {
  decimal,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  CancellationRefundModel,
  CancellationRequestModel,
} from '../../cancellation-policy/models/cancellationPolicy.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

export const RefundReviewModel = pgTable(
  'cancellation_refund_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    cancellationRequestId: uuid('cancellation_request_id')
      .references(() => CancellationRequestModel.id, { onDelete: 'cascade' })
      .notNull(),
    cancellationRefundId: uuid('cancellation_refund_id').references(
      () => CancellationRefundModel.id,
      { onDelete: 'set null' }
    ),
    reasonCategory: varchar('reason_category', { length: 100 }).notNull(),
    policyReference: varchar('policy_reference', { length: 100 }),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 30 }).default('PENDING').notNull(),
    patientNote: text('patient_note'),
    decision: varchar('decision', { length: 20 }),
    decisionNote: text('decision_note'),
    failureReason: text('failure_reason'),
    reviewedBy: uuid('reviewed_by').references(() => UserModel.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_review_appointment_unique').on(table.appointmentId),
    index('refund_review_clinic_status_idx').on(table.clinicId, table.status),
  ]
);

export const RefundReviewDocumentModel = pgTable(
  'refund_review_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundReviewId: uuid('refund_review_id')
      .references(() => RefundReviewModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    storageUrl: text('storage_url').notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => UserModel.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('refund_review_document_review_idx').on(table.refundReviewId),
  ]
);
