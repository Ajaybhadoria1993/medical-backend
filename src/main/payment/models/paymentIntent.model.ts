import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  decimal,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { ClinicModel } from '../../clinic/models/clinic.model';

/**
 * Payment Intent Model
 *
 * Represents the desire to pay for a domain entity (Appointment, Subscription Upgrade, Addon).
 * Bridges the checkout session before the final domain entity is created in Postgres.
 */
export const PaymentIntentModel = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),

    // Checkout Temporary Identifier (e.g. temp_apt_..., temp_sub_...)
    checkoutReferenceId: varchar('checkout_reference_id', {
      length: 255,
    }).notNull(),

    // Polymorphic Pointers to Final Domain Models (Filled post-payment success)
    sourceType: varchar('source_type', { length: 50 }).notNull(), // 'APPOINTMENT', 'SUBSCRIPTION_UPGRADE', 'ADDON'
    sourceId: uuid('source_id'), // Nullable until payment success

    status: varchar('status', { length: 50 })
      .default('REQUIRES_PAYMENT')
      .notNull(), // 'REQUIRES_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(), // Target Rupees payable

    // Dynamic Split snapshots calculated before order creation
    financialSnapshot: jsonb('financial_snapshot'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('checkout_ref_unique_idx').on(
      table.sourceType,
      table.checkoutReferenceId
    ),
    index('payment_intent_clinic_idx').on(table.clinicId),
    index('payment_intent_source_idx').on(table.sourceType, table.sourceId),
  ]
);

export type PaymentIntent = InferSelectModel<typeof PaymentIntentModel>;
export type NewPaymentIntent = InferInsertModel<typeof PaymentIntentModel>;
