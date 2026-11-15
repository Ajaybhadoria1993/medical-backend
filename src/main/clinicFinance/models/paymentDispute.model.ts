import {
  decimal,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

export const PaymentDisputeModel = pgTable(
  'payment_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'restrict' })
      .notNull(),
    appointmentPaymentId: uuid('appointment_payment_id')
      .references(() => AppointmentPaymentModel.id, { onDelete: 'restrict' })
      .notNull(),
    paymentProvider: varchar('payment_provider', { length: 50 }).notNull(),
    providerDisputeId: varchar('provider_dispute_id', {
      length: 255,
    }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 40 }).notNull(),
    resolutionParty: varchar('resolution_party', { length: 20 }),
    filedAt: timestamp('filed_at').notNull(),
    resolvedAt: timestamp('resolved_at'),
    providerResponse: jsonb('provider_response'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_dispute_provider_unique').on(
      table.paymentProvider,
      table.providerDisputeId
    ),
    index('payment_dispute_clinic_status_idx').on(table.clinicId, table.status),
    index('payment_dispute_appointment_idx').on(table.appointmentId),
  ]
);

export const PaymentDisputeEvidenceModel = pgTable(
  'payment_dispute_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .references(() => PaymentDisputeModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    storageUrl: text('storage_url').notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    providerEvidenceId: varchar('provider_evidence_id', { length: 255 }),
    uploadedBy: uuid('uploaded_by').references(() => UserModel.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('payment_dispute_evidence_dispute_idx').on(table.disputeId)]
);
