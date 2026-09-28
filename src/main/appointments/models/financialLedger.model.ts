import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  decimal,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from './appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { AppointmentPaymentModel } from './appointment-payment.model';

export const FinancialLedgerModel = pgTable(
  'financial_ledgers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    paymentId: uuid('payment_id')
      .references(() => AppointmentPaymentModel.id, { onDelete: 'cascade' })
      .notNull(),

    // Ledger fields
    entryType: varchar('entry_type', { length: 50 }).notNull(), // 'PAYMENT_RECEIVED' | 'TRANSFER_CREATED' ...
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(), // positive = credit/inflow, negative = debit/outflow
    description: varchar('description', { length: 255 }),
    gatewayReferenceId: varchar('gateway_reference_id', { length: 255 }), // refundId, transferId, paymentId
    metaData: jsonb('meta_data'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Indexing for rapid audit reconciliations by clinic, appointment, or reference
    index('ledger_clinic_idx').on(table.clinicId),
    index('ledger_appointment_idx').on(table.appointmentId),
    index('ledger_gateway_ref_idx').on(table.gatewayReferenceId),
  ]
);
