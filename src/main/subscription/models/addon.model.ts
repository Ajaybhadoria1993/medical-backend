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
import { PlanVersionModel } from './planVersion.model';
import { SubscriptionPlanModel } from './subscription.model';

export type AddOn = InferSelectModel<typeof AddOnModel>;

export type ClinicAddOn = InferSelectModel<typeof ClinicAddOnModel>;

export type PlanAddOnLimit = InferSelectModel<typeof PlanAddOnLimitsModel>;

/** `feature_key` names the plan limit the add-on raises, e.g. additional_doctor → doctor_accounts. */
export const AddOnModel = pgTable(
  'add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),

    featureKey: varchar('feature_key', { length: 100 }).notNull().unique(),

    /** Limit added per unit, e.g. 1 doctor or 1024 MB storage. */
    unitValue: integer('unit_value').default(1).notNull(),

    monthlyPrice: decimal('monthly_price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    yearlyPrice: decimal('yearly_price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    currency: varchar('currency', { length: 8 }).default('INR').notNull(),

    isActive: boolean('is_active').default(true).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('add_on_feature_key_unique').on(table.featureKey)]
);

/** Which add-ons a plan allows and how many; no row = not allowed on that plan. */
export const PlanAddOnLimitsModel = pgTable(
  'plan_add_on_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    planId: uuid('plan_id')
      .references(() => SubscriptionPlanModel.id, { onDelete: 'cascade' })
      .notNull(),

    /** Limits belong to one version, so a new version can change them without touching clinics on the old one. */
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => PlanVersionModel.id),

    addOnId: uuid('add_on_id')
      .references(() => AddOnModel.id, { onDelete: 'cascade' })
      .notNull(),

    /** null = no cap; 0 = not allowed. */
    maxCap: integer('max_cap'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('plan_add_on_limits_plan_idx').on(table.planId),
    index('plan_add_on_limits_addon_idx').on(table.addOnId),
    uniqueIndex('plan_add_on_limits_version_addon_unique').on(
      table.planVersionId,
      table.addOnId
    ),
  ]
);

export const ClinicAddOnModel = pgTable(
  'clinic_add_ons',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id').notNull(),

    addOnId: uuid('add_on_id')
      .references(() => AddOnModel.id, { onDelete: 'cascade' })
      .notNull(),

    quantity: integer('quantity').default(1).notNull(),

    billingCycle: varchar('billing_cycle', { length: 20 }).notNull(),

    startsAt: timestamp('starts_at').defaultNow().notNull(),

    /** null = active until cancelled. */
    expiresAt: timestamp('expires_at'),

    isActive: boolean('is_active').default(true).notNull(),

    provider: varchar('provider', { length: 80 }),

    /** Holds the Razorpay order id. */
    providerSubscriptionId: varchar('provider_subscription_id', {
      length: 200,
    }),

    paymentStatus: varchar('payment_status', { length: 20 }).default('pending'),
    paymentMode: varchar('payment_mode', { length: 20 }),
    transactionId: varchar('transaction_id', { length: 100 }),

    price: decimal('price', { precision: 12, scale: 2 })
      .default('0.00')
      .notNull(),

    /** true = does not renew after expiresAt. */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    /** Units still usable now but removed at the next period boundary. */
    scheduledReductionBy: integer('scheduled_reduction_by')
      .default(0)
      .notNull(),
    reductionEffectiveAt: timestamp('reduction_effective_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancellationReason: varchar('cancellation_reason', { length: 255 }),
    /** Doctors or staff the Admin chose to deactivate when this add-on ends. */
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
