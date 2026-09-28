// src/main/subscription/models/addon.model.ts
import {
  boolean,
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
import type { InferSelectModel } from 'drizzle-orm';

/** Inferred type for AddOnModel select queries */
export type AddOn = InferSelectModel<typeof AddOnModel>;

/** Inferred type for ClinicAddOnModel select queries */
export type ClinicAddOn = InferSelectModel<typeof ClinicAddOnModel>;

/**
 * Add-On Master Data
 *
 * Defines available add-ons that clinics can purchase.
 * Each row represents one purchasable add-on.
 *
 * Feature Keys (used in code to calculate limits):
 * - additional_doctor    → adds doctor_accounts limit
 * - additional_staff     → adds staff_accounts limit
 * - additional_storage   → adds cloud_storage limit (in MB, 1024 MB per unit)
 * - additional_branch    → adds branch_count limit
 */
export const AddOnModel = pgTable(
  'add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),

    /** Unique key that links to plan_limits featureKey */
    featureKey: varchar('feature_key', { length: 100 }).notNull().unique(),

    /** Value added per unit (e.g., 1 doctor, 1GB storage) */
    unitValue: integer('unit_value').default(1).notNull(),

    /** Monthly price in rupees */
    monthlyPrice: decimal('monthly_price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    /** Yearly price in rupees (typically 10% discount) */
    yearlyPrice: decimal('yearly_price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    currency: varchar('currency', { length: 8 }).default('INR').notNull(),

    /** Optional maximum total cap constraint (Base + Add-ons) */
    maxCap: integer('max_cap'),

    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('add_on_feature_key_unique').on(table.featureKey)]
);

/**
 * Clinic Add-On Purchase Records
 *
 * Tracks which add-ons a clinic has purchased, their billing cycle,
 * and subscription status.
 */
export const ClinicAddOnModel = pgTable(
  'clinic_add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id').notNull(),

    addOnId: uuid('add_on_id')
      .references(() => AddOnModel.id, { onDelete: 'cascade' })
      .notNull(),

    /** Number of units purchased */
    quantity: integer('quantity').default(1).notNull(),

    /** Billing cycle: 'monthly' or 'yearly' */
    billingCycle: varchar('billing_cycle', { length: 20 }).notNull(),

    startsAt: timestamp('starts_at').defaultNow().notNull(),

    /** Null means active until cancelled (for some billing cycles) */
    expiresAt: timestamp('expires_at'),

    /** Whether this add-on is currently active */
    isActive: boolean('is_active').default(true).notNull(),

    /** Payment provider (razorpay, etc.) */
    provider: varchar('provider', { length: 80 }),

    /** Provider's subscription/order ID */
    providerSubscriptionId: varchar('provider_subscription_id', {
      length: 200,
    }),

    paymentStatus: varchar('payment_status', { length: 20 }).default('pending'),
    paymentMode: varchar('payment_mode', { length: 20 }),
    transactionId: varchar('transaction_id', { length: 100 }),

    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    /** If true, add-on will NOT renew after expiresAt */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    /** When the user requested cancellation */
    cancelledAt: timestamp('cancelled_at'),
    /** Optional reason from user */
    cancellationReason: varchar('cancellation_reason', { length: 255 }),
    /** User IDs (doctors or staff) chosen by Admin to deactivate when this add-on expires */
    scheduledDeactivateUserIds: jsonb('scheduled_deactivate_user_ids')
      .$type<string[]>()
      .default([])
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('clinic_add_ons_clinic_idx').on(table.clinicId),
    index('clinic_add_ons_add_on_idx').on(table.addOnId),
    index('clinic_add_ons_active_idx').on(table.isActive),
  ]
);
