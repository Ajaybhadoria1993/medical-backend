import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
import { decimal } from 'drizzle-orm/pg-core';
import { and, eq, not } from 'drizzle-orm';
import { AppointmentModel } from './appointment.model';

/**
 * Appointment Payment Model
 * Stores all payment and refund related data for an appointment.
 * One-to-one relationship with AppointmentModel.
 */
export const AppointmentPaymentModel = pgTable(
  'appointment_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    paymentMode: varchar('payment_mode'),
    paymentStatus: varchar('payment_status').default('Paid'),
    price: decimal('price', { precision: 12, scale: 2 }),
    primaryServicePrice: decimal('primary_service_price', {
      precision: 12,
      scale: 2,
    }),
    paymentNotes: varchar('payment_notes'),

    // Structured Gateway columns
    transactionId: varchar('transaction_id', { length: 255 }).unique(),
    gatewayOrderId: varchar('gateway_order_id', { length: 255 }),
    gatewayResponse: jsonb('gateway_response'),

    // Dynamic Breakdown Logging columns
    platformCommission: decimal('platform_commission', {
      precision: 12,
      scale: 2,
    }),
    pgFee: decimal('pg_fee', { precision: 12, scale: 2 }),
    gstAmount: decimal('gst_amount', { precision: 12, scale: 2 }),
    convenienceFee: decimal('convenience_fee', { precision: 12, scale: 2 }),
    transferredAmount: decimal('transferred_amount', {
      precision: 12,
      scale: 2,
    }),
    transfersData: jsonb('transfers_data'),

    // Immutable Financial Snapshots column
    financialSnapshot: jsonb('financial_snapshot'), // Locks versioned configuration state used during booking

    refundMode: varchar('refund_mode'),
    refundedAmount: varchar('refunded_amount'),
    refundNotes: varchar('refund_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('transaction_idx').on(table.transactionId)]
);

/** Omits unpaid online checkouts; needs a leftJoin on AppointmentPaymentModel. Lives here so the queue engine can use it without the service's import cycle. */
export function activeAppointmentFilter() {
  return not(
    and(
      eq(AppointmentModel.appointmentStatus, 'Pending'),
      eq(AppointmentPaymentModel.paymentMode, 'Online'),
      eq(AppointmentPaymentModel.paymentStatus, 'Pending')
    )!
  );
}
