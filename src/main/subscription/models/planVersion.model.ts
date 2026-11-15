import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  check,
  decimal,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { SubscriptionPlanModel } from './subscription.model';

/** Never edited once a subscription uses it; a price or limit change is a new version.
 *  A paid plan needs at least one price: the service checks it, since a CHECK can't see the plan's kind. */
export const PlanVersionModel = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => SubscriptionPlanModel.id),
    versionNo: integer('version_no').notNull(),
    /** null = the plan is not sold monthly. */
    monthlyPrice: decimal('monthly_price', { precision: 12, scale: 2 }),
    /** null = not sold yearly; entered directly, never derived from the monthly price. */
    yearlyPrice: decimal('yearly_price', { precision: 12, scale: 2 }),
    /** New buyers and renewals use the latest version whose start has passed. */
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('plan_versions_plan_version_no_unique').on(
      t.planId,
      t.versionNo
    ),
    uniqueIndex('plan_versions_plan_effective_from_unique').on(
      t.planId,
      t.effectiveFrom
    ),
    check(
      'plan_versions_prices_ck',
      sql`(${t.monthlyPrice} IS NULL OR ${t.monthlyPrice} >= 0) AND (${t.yearlyPrice} IS NULL OR ${t.yearlyPrice} >= 0)`
    ),
    check('plan_versions_version_no_ck', sql`${t.versionNo} >= 1`),
  ]
);

export type PlanVersion = InferSelectModel<typeof PlanVersionModel>;
export type NewPlanVersion = InferInsertModel<typeof PlanVersionModel>;
