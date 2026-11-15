import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { PlanVersionModel } from './planVersion.model';
import { SubscriptionPlanModel } from './subscription.model';

/** A plan's limits and feature flags; every key and value per plan is in `drizzle/seeds/subscriptions.seed.ts`. */
export const PlanFeaturesModel = pgTable(
  'plan_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    planId: uuid('plan_id')
      .notNull()
      .references(() => SubscriptionPlanModel.id, { onDelete: 'cascade' }),

    /** Limits belong to one version, so a new version can change them without touching clinics on the old one. */
    planVersionId: uuid('plan_version_id')
      .notNull()
      .references(() => PlanVersionModel.id),

    featureKey: varchar('feature_key', { length: 100 }).notNull(),

    /** Shown in the UI; falls back to `featureKey` when empty. */
    displayName: varchar('display_name', { length: 150 }),

    description: varchar('description', { length: 255 }),

    /** 'numeric' uses `limitValue`, 'boolean' uses `enabled`, 'marketing' is display only. */
    type: varchar('type', { length: 20 }).notNull().default('numeric'),

    /** null = read `enabled` instead. */
    limitValue: integer('limit_value'),

    isUnlimited: boolean('is_unlimited').default(false).notNull(),

    enabled: boolean('enabled').default(true).notNull(),

    sortOrder: integer('sort_order').default(0),

    isMarketingFeature: boolean('is_marketing_feature').default(false),

    /** A selling point tied to a limit; hidden from clinics when that limit is off. */
    linkedFeatureKey: varchar('linked_feature_key', { length: 100 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('plan_features_version_key_unique').on(
      table.planVersionId,
      table.featureKey
    ),
  ]
);

export type PlanFeature = typeof PlanFeaturesModel.$inferSelect;
export type NewPlanFeature = typeof PlanFeaturesModel.$inferInsert;
