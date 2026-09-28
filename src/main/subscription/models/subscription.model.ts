import {
  boolean,
  decimal,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Subscription Plan Model
 *
 * Defines available subscription plans (e.g., Free, Pro Monthly, Pro Yearly).
 * Each row represents one plan with its pricing.
 */
export const SubscriptionPlanModel = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 80 }).notNull().unique(), // e.g. 'Free','pro-monthly'
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 255 }),
    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    currency: varchar('currency', { length: 8 }).default('INR').notNull(),
    /** Indicates if this plan is granted when a clinic activates a free trial */
    isTrialPlan: boolean('is_trial_plan').default(false).notNull(),
    /** Default duration in days for free trial of this plan */
    trialDays: integer('trial_days'),
    /** Indicates if this plan is the default fallback plan when a paid/trial plan expires */
    isDefaultFallback: boolean('is_default_fallback').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('subscription_plan_unique').on(table.slug)]
);

/**
 * Clinic Subscription Model
 *
 * Tracks subscriptions for clinics. Each clinic can have multiple subscriptions
 * (historical records), but only one active at a time.
 */
export const ClinicSubscriptionModel = pgTable(
  'clinic_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(), // Reference to clinic (not FK to avoid circular dependency)
    planId: uuid('plan_id')
      .references(() => SubscriptionPlanModel.id)
      .notNull(),
    startsAt: timestamp('starts_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    active: boolean('active').default(true).notNull(),
    provider: varchar('provider', { length: 80 }),
    providerSubscriptionId: varchar('provider_subscription_id', {
      length: 200,
    }),
    paymentStatus: varchar('payment_status', { length: 20 }).default('pending'),
    paymentMode: varchar('payment_mode', { length: 20 }),
    transactionId: varchar('transaction_id', { length: 50 }),
    discount: decimal('discount', { precision: 12, scale: 2 }).default('0.00'),
    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    /** If true, subscription will NOT renew after expires_at */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    /** When the user requested cancellation (null if not cancelled) */
    cancelledAt: timestamp('cancelled_at'),
    /** Optional reason from user */
    cancellationReason: varchar('cancellation_reason', { length: 255 }),
    /** Auto-pay: If true, Razorpay will auto-charge before expiry */
    autoRenew: boolean('auto_renew').default(false).notNull(),
    /** Razorpay subscription ID for recurring payments (null if auto-pay not enabled) */
    razorpaySubscriptionId: varchar('razorpay_subscription_id', {
      length: 200,
    }),
    /**
     * Scheduled plan change (downgrade): the target plan to switch to at the
     * end of the current billing period. Null when no change is scheduled.
     */
    scheduledPlanId: uuid('scheduled_plan_id').references(
      () => SubscriptionPlanModel.id
    ),
    /** When the scheduled plan change takes effect (usually current expiresAt) */
    scheduledPlanChangeAt: timestamp('scheduled_plan_change_at'),
    /** Target billing cycle marker for the scheduled plan (e.g. 'pro-monthly', 'pro-yearly', 'free_plan') */
    scheduledProviderSubscriptionId: varchar(
      'scheduled_provider_subscription_id',
      { length: 200 }
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('clinic_subscriptions_clinic_idx').on(table.clinicId),
    index('clinic_subscriptions_active_idx').on(table.active),
    uniqueIndex('ux_clinic_active_subscription')
      .on(table.clinicId)
      .where(sql`${table.active} = true`),
  ]
);

// Type exports
export type SubscriptionPlan = typeof SubscriptionPlanModel.$inferSelect;
export type NewSubscriptionPlan = typeof SubscriptionPlanModel.$inferInsert;
export type ClinicSubscription = typeof ClinicSubscriptionModel.$inferSelect;
export type NewClinicSubscription = typeof ClinicSubscriptionModel.$inferInsert;
