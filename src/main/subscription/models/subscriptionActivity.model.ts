// src/main/subscription/models/subscriptionActivity.model.ts
import {
  decimal,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

/** Inferred type for SubscriptionActivityModel select queries */
export type SubscriptionActivity = InferSelectModel<
  typeof SubscriptionActivityModel
>;

/** Inferred type for SubscriptionActivityModel insert queries */
export type NewSubscriptionActivity = InferInsertModel<
  typeof SubscriptionActivityModel
>;

/**
 * The set of activity types the timeline understands. Kept as a plain union
 * (not a pg enum) so adding a type is a code change rather than a migration —
 * the FE falls back to a neutral icon for anything it doesn't recognise.
 */
export const SUBSCRIPTION_ACTIVITY_TYPES = [
  'subscription_created',
  'plan_upgraded',
  'plan_downgraded',
  'plan_change_scheduled',
  'renewal_payment',
  'payment_failed',
  'addon_purchased',
  'addon_removal_scheduled',
  'addon_removal_undone',
  'addon_quantity_reduced',
  'addon_quantity_reduction_scheduled',
  'addon_quantity_reduction_applied',
  'addon_expired',
  'autopay_enabled',
  'autopay_disabled',
  'autopay_authorized',
  'autopay_amount_synced',
  'cancel_scheduled',
  'cancel_undone',
  'subscription_expired',
  'coupon_applied',
  'free_trial_started',
  'account_access_email_sent',
  'account_closed',
  'credits_purchased',
  // Super Admin billing tools; the reason is the description.
  'payment_refunded',
  'plan_extended',
  'invoice_resent',
  'billing_synced',
  'billing_test',
  'free_trial_changed',
] as const;

export type SubscriptionActivityType =
  (typeof SUBSCRIPTION_ACTIVITY_TYPES)[number];

export const SubscriptionActivityModel = pgTable(
  'subscription_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id').notNull(),

    /** One of SUBSCRIPTION_ACTIVITY_TYPES. */
    type: varchar('type', { length: 64 }).notNull(),

    /** Short human-readable headline, e.g. "AutoPay enabled". */
    title: varchar('title', { length: 200 }).notNull(),

    /** Optional supporting line, e.g. "Renews automatically on 27 Aug 2026". */
    description: text('description'),

    /** Rupee amount when the event moved money; null otherwise. */
    amount: decimal('amount', { precision: 12, scale: 2 }),

    currency: varchar('currency', { length: 8 }).default('INR').notNull(),

    /**
     * The user who triggered it. Null for system-driven events (cron expiry,
     * Razorpay webhooks) — those genuinely have no actor, and recording a
     * misleading one is worse than recording none.
     */
    actorUserId: uuid('actor_user_id'),

    /** Free-form context (plan ids, razorpay ids, quantities) for support. */
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // The only read pattern is "this clinic's activity, newest first".
    clinicCreatedIdx: index('subscription_activity_clinic_created_idx').on(
      table.clinicId,
      table.createdAt
    ),
  })
);
