import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AddOnModel } from './addon.model';
import type { ScheduledStaffChange } from '../types/scheduledChange.types';
import { PlanVersionModel } from './planVersion.model';
import { ownerTypeEnum, SubscriptionPlanModel } from './subscription.model';

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
  'replaced',
]);

/** `none` = the free plan or a trial: nothing renews. */
export const subscriptionBillingCycleEnum = pgEnum(
  'subscription_billing_cycle',
  ['monthly', 'yearly', 'none']
);

export const subscriptionAddOnStatusEnum = pgEnum(
  'subscription_add_on_status',
  ['active', 'cancelled']
);

const tz = { withTimezone: true } as const;

/** Renewals extend the same row; prices, payments and AutoPay live in their own tables. */
export const SubscriptionModel = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    /** Clinic / lab / pharmacy id; no FK across modules. */
    ownerId: uuid('owner_id').notNull(),
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => PlanVersionModel.id),
    status: subscriptionStatusEnum('status').notNull(),
    billingCycle: subscriptionBillingCycleEnum('billing_cycle').notNull(),
    currentPeriodStart: timestamp('current_period_start', tz).notNull(),
    /** null for the free plan; calendar month / year otherwise. */
    currentPeriodEnd: timestamp('current_period_end', tz),
    /** Day of month renewals land on; a short month uses its last day. */
    billingAnchorDay: integer('billing_anchor_day'),
    isTrial: boolean('is_trial').default(false).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    cancelledAt: timestamp('cancelled_at', tz),
    cancellationReason: varchar('cancellation_reason', { length: 255 }),
    scheduledPlanId: uuid('scheduled_plan_id').references(
      () => SubscriptionPlanModel.id
    ),
    scheduledBillingCycle: subscriptionBillingCycleEnum(
      'scheduled_billing_cycle'
    ),
    scheduledChangeAt: timestamp('scheduled_change_at', tz),
    scheduledStaffChange: jsonb(
      'scheduled_staff_change'
    ).$type<ScheduledStaffChange>(),
    /** Set when the row stops being current: cancelled, replaced or expired. */
    endedAt: timestamp('ended_at', tz),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('subscriptions_owner_idx').on(t.ownerType, t.ownerId),
    uniqueIndex('subscriptions_one_current_per_owner')
      .on(t.ownerType, t.ownerId)
      .where(sql`${t.status} IN ('trialing', 'active', 'past_due')`),
    index('subscriptions_status_period_end_idx').on(
      t.status,
      t.currentPeriodEnd
    ),
    index('subscriptions_scheduled_change_idx')
      .on(t.scheduledChangeAt)
      .where(sql`${t.scheduledChangeAt} IS NOT NULL`),
    index('subscriptions_plan_version_idx').on(t.planVersionId),
    check(
      'subscriptions_period_ck',
      sql`${t.currentPeriodEnd} IS NULL OR ${t.currentPeriodEnd} > ${t.currentPeriodStart}`
    ),
    check(
      'subscriptions_anchor_day_ck',
      sql`${t.billingAnchorDay} IS NULL OR ${t.billingAnchorDay} BETWEEN 1 AND 31`
    ),
    // A plan that renews needs both its end date and its renewal day.
    check(
      'subscriptions_renewing_ck',
      sql`${t.billingCycle} = 'none' OR (${t.currentPeriodEnd} IS NOT NULL AND ${t.billingAnchorDay} IS NOT NULL)`
    ),
  ]
);

/** Add-ons on a subscription; they follow its period, so they have no expiry of their own. */
export const SubscriptionAddOnModel = pgTable(
  'subscription_add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => SubscriptionModel.id),
    addOnId: uuid('add_on_id')
      .notNull()
      .references(() => AddOnModel.id),
    quantity: integer('quantity').default(1).notNull(),
    status: subscriptionAddOnStatusEnum('status').default('active').notNull(),
    /** Quantity from the next period (reduce or remove at period end); null = no change. */
    scheduledQuantity: integer('scheduled_quantity'),
    scheduledDeactivateUserIds: jsonb('scheduled_deactivate_user_ids')
      .$type<string[]>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('subscription_add_ons_one_active_per_add_on')
      .on(t.subscriptionId, t.addOnId)
      .where(sql`${t.status} = 'active'`),
    index('subscription_add_ons_owner_idx').on(t.ownerType, t.ownerId),
    index('subscription_add_ons_add_on_idx').on(t.addOnId),
    check('subscription_add_ons_quantity_ck', sql`${t.quantity} > 0`),
    check(
      'subscription_add_ons_scheduled_quantity_ck',
      sql`${t.scheduledQuantity} IS NULL OR ${t.scheduledQuantity} >= 0`
    ),
  ]
);

export type Subscription = InferSelectModel<typeof SubscriptionModel>;
export type NewSubscription = InferInsertModel<typeof SubscriptionModel>;
export type SubscriptionAddOn = InferSelectModel<typeof SubscriptionAddOnModel>;
export type NewSubscriptionAddOn = InferInsertModel<
  typeof SubscriptionAddOnModel
>;
