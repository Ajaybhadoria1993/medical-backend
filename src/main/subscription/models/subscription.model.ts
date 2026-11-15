import {
  boolean,
  check,
  decimal,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const ownerTypeEnum = pgEnum('subscription_owner_type', [
  'clinic',
  'lab',
  'pharmacy',
]);

export const planKindEnum = pgEnum('subscription_plan_kind', ['free', 'paid']);

export const SubscriptionPlanModel = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 80 }).notNull().unique(),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 255 }),
    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    currency: varchar('currency', { length: 8 }).default('INR').notNull(),
    /** Which kind of account can buy the plan. */
    ownerType: ownerTypeEnum('owner_type').default('clinic').notNull(),
    kind: planKindEnum('kind').default('paid').notNull(),
    /** false hides the plan from new buyers; plans are never deleted. */
    isActive: boolean('is_active').default(true).notNull(),
    /** The plan a free trial gives. */
    isTrialPlan: boolean('is_trial_plan').default(false).notNull(),
    trialDays: integer('trial_days'),
    /** The plan an owner falls back to when a paid plan or trial ends. */
    isDefaultFallback: boolean('is_default_fallback').default(false).notNull(),
    isMostPopular: boolean('is_most_popular').default(false).notNull(),
    /** Struck-through "was" price on plan cards; display only, never charged. Shown when above the real price. */
    compareAtMonthly: decimal('compare_at_monthly', {
      precision: 12,
      scale: 2,
    }),
    compareAtYearly: decimal('compare_at_yearly', { precision: 12, scale: 2 }),
    /** Set when a Super Admin ends the plan: after this its clinics cannot renew it. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** Where its clinics go at their next renewal after endsAt; null means they choose (or fall to Free). */
    replacementPlanId: uuid('replacement_plan_id').references(
      (): AnyPgColumn => SubscriptionPlanModel.id
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('subscription_plan_unique').on(table.slug),
    check(
      'subscription_plans_replacement_ck',
      sql`${table.replacementPlanId} IS NULL OR (${table.replacementPlanId} <> ${table.id} AND ${table.endsAt} IS NOT NULL)`
    ),
    uniqueIndex('subscription_plans_one_trial_per_owner_type')
      .on(table.ownerType)
      .where(sql`${table.isTrialPlan} = true`),
    uniqueIndex('subscription_plans_one_fallback_per_owner_type')
      .on(table.ownerType)
      .where(sql`${table.isDefaultFallback} = true`),
  ]
);

/** Many rows per clinic (history), only one active. */
export const ClinicSubscriptionModel = pgTable(
  'clinic_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** No FK, to avoid a circular dependency with the clinic module. */
    clinicId: uuid('clinic_id').notNull(),
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
    /** Captured payment's gateway ids, for reconciliation; `provider` names the gateway. */
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    providerOrderId: varchar('provider_order_id', { length: 255 }),
    discount: decimal('discount', { precision: 12, scale: 2 }).default('0.00'),
    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),
    /** true = does not renew after expires_at. */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    cancelledAt: timestamp('cancelled_at'),
    cancellationReason: varchar('cancellation_reason', { length: 255 }),
    autoRenew: boolean('auto_renew').default(false).notNull(),
    /** null when AutoPay is off. */
    providerMandateId: varchar('provider_mandate_id', {
      length: 200,
    }),
    /** New mandate being authorized to replace the current active mandate. */
    pendingProviderSubscriptionId: varchar('pending_provider_subscription_id', {
      length: 200,
    }),
    /** Last bank rail confirmed by Razorpay for the active mandate. */
    autoRenewPaymentMethod: varchar('auto_renew_payment_method', {
      length: 32,
    }),
    /** Present when the provider halted the last automatic renewal mandate. */
    autoRenewFailureReason: varchar('auto_renew_failure_reason', {
      length: 255,
    }),
    /** Plan switched to at the period end (downgrade); null when nothing is scheduled. */
    scheduledPlanId: uuid('scheduled_plan_id').references(
      () => SubscriptionPlanModel.id
    ),
    scheduledPlanChangeAt: timestamp('scheduled_plan_change_at'),
    /** Billing-cycle marker of the scheduled plan, e.g. 'pro-yearly' or 'free_plan'. */
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
    // One captured payment backs one row; renewals update the row in place, so this never blocks a real charge.
    uniqueIndex('ux_clinic_subscription_provider_payment')
      .on(table.clinicId, table.providerPaymentId)
      .where(sql`${table.providerPaymentId} is not null`),
  ]
);

// Type exports
export type SubscriptionPlan = typeof SubscriptionPlanModel.$inferSelect;
export type NewSubscriptionPlan = typeof SubscriptionPlanModel.$inferInsert;
export type ClinicSubscription = typeof ClinicSubscriptionModel.$inferSelect;
export type NewClinicSubscription = typeof ClinicSubscriptionModel.$inferInsert;
