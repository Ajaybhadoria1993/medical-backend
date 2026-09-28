import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { SubscriptionPlanModel } from './subscription.model';

/**
 * Plan Features / Limits Model
 *
 * Unified table for both feature definitions (marketing/display) and numeric/boolean limits.
 * Replaces FeatureModel + PlanLimitsModel
 *
 * Feature Keys (used in code):
 * - whatsapp_messages_per_month  → value: null/unlimited (all plans)
 * - doctor_accounts              → value: 1 (free), 2 (premium)
 * - staff_accounts               → value: 1 (free), 4 (premium)
 * - cloud_storage                → value: 100 MB (free), 500 MB (basic), 3072 MB (pro)
 * - storage_months               → value: 3 (free), null/unlimited (basic/premium)
 * - payment_history_months       → value: 3 (free), null/unlimited (premium)
 * - lab_integration              → enabled: false (free), true (premium)
 * - pharmacy_integration         → enabled: false (free), true (premium)
 * - dashboard_full_access        → enabled: false (free), true (premium)
 * - reports_analytics            → enabled: false (free), true (premium)
 * - smart_prescriptions          → enabled: true (all plans)
 * - custom_branded_rx            → enabled: false (free), true (basic/premium)
 * - ocr_prescription_scan        → enabled: false (free), false (basic), true (premium)
 * - chatbot_support              → enabled: false (free), true (basic/premium)
 * - priority_support             → enabled: false (free), false (basic), true (premium)
 * - add_ons                      → enabled: false (free), true (basic/premium)
 * - waiting_room_queue           → enabled: true (all plans)
 */
export const PlanFeaturesModel = pgTable(
  'plan_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    planId: uuid('plan_id')
      .notNull()
      .references(() => SubscriptionPlanModel.id, { onDelete: 'cascade' }),

    /** Unique feature key identifier */
    featureKey: varchar('feature_key', { length: 100 }).notNull(),

    /** Human-readable display name (optional, derived from featureKey if not set) */
    displayName: varchar('display_name', { length: 150 }),

    /** Human-readable description */
    description: varchar('description', { length: 255 }),

    /**
     * Feature type:
     * - 'numeric': has a limitValue (e.g., 100 messages/month)
     * - 'boolean': is enabled/disabled (e.g., lab_integration)
     * - 'marketing': display-only feature (e.g., "Smart Prescriptions")
     */
    type: varchar('type', { length: 20 }).notNull().default('numeric'),

    /** Numeric limit value (null means check `enabled` flag instead) */
    limitValue: integer('limit_value'),

    /** If true, this feature has no numeric cap (unlimited) */
    isUnlimited: boolean('is_unlimited').default(false).notNull(),

    /** For boolean features: is this feature enabled for this plan? */
    enabled: boolean('enabled').default(true).notNull(),

    /** For display ordering */
    sortOrder: integer('sort_order').default(0),

    /** Whether this is a marketing/highlighted feature */
    isMarketingFeature: boolean('is_marketing_feature').default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('plan_features_plan_key_unique').on(
      table.planId,
      table.featureKey
    ),
  ]
);

export type PlanFeature = typeof PlanFeaturesModel.$inferSelect;
export type NewPlanFeature = typeof PlanFeaturesModel.$inferInsert;
