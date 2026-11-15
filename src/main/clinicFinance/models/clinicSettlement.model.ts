import {
  decimal,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';

export const ClinicSettlementModel = pgTable(
  'clinic_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    paymentProvider: varchar('payment_provider', { length: 50 }).notNull(),
    providerSettlementId: varchar('provider_settlement_id', {
      length: 255,
    }).notNull(),
    gatewayAccountId: varchar('gateway_account_id', { length: 255 }),
    cycleStart: timestamp('cycle_start').notNull(),
    cycleEnd: timestamp('cycle_end').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    failureReason: varchar('failure_reason', { length: 500 }),
    expectedSettlementAt: timestamp('expected_settlement_at'),
    settledAt: timestamp('settled_at'),
    gatewayResponse: jsonb('gateway_response'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('clinic_settlement_provider_unique').on(
      table.paymentProvider,
      table.providerSettlementId
    ),
    index('clinic_settlement_clinic_status_idx').on(
      table.clinicId,
      table.status
    ),
    index('clinic_settlement_cycle_idx').on(
      table.clinicId,
      table.cycleStart,
      table.cycleEnd
    ),
  ]
);

export const ClinicSettlementItemModel = pgTable(
  'clinic_settlement_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    settlementId: uuid('settlement_id')
      .references(() => ClinicSettlementModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    paymentProvider: varchar('payment_provider', { length: 50 }).notNull(),
    appointmentPaymentId: uuid('appointment_payment_id')
      .references(() => AppointmentPaymentModel.id, { onDelete: 'restrict' })
      .notNull(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'restrict' })
      .notNull(),
    providerTransferId: varchar('provider_transfer_id', { length: 255 }),
    clinicAmount: decimal('clinic_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),
    reversedAmount: decimal('reversed_amount', {
      precision: 12,
      scale: 2,
    })
      .default('0')
      .notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('clinic_settlement_transfer_unique').on(
      table.paymentProvider,
      table.providerTransferId
    ),
    uniqueIndex('clinic_settlement_payment_unique').on(
      table.settlementId,
      table.appointmentPaymentId
    ),
    index('clinic_settlement_item_clinic_idx').on(table.clinicId),
    index('clinic_settlement_item_appointment_idx').on(table.appointmentId),
  ]
);
