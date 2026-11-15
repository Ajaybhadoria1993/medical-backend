import type { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** inclusive: the price contains GST; exclusive: GST is added on top; none: no GST (Bill of Supply). */
export const billingTaxModeEnum = pgEnum('billing_tax_mode', [
  'inclusive',
  'exclusive',
  'none',
]);

const tz = { withTimezone: true } as const;

/** GST settings for MediArogya's own bills, one row per change; a row in force is never edited. */
export const BillingTaxRateModel = pgTable(
  'billing_tax_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Basis points: 1800 = 18%. */
    rateBp: integer('rate_bp').notNull(),
    mode: billingTaxModeEnum('mode').notNull(),
    effectiveFrom: timestamp('effective_from', tz).notNull(),
    /** Days of notice clinics were given; 0 when the Super Admin applied it at once. */
    noticeDays: integer('notice_days').default(0).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    createdBy: uuid('created_by').notNull(),
    /** Set when a scheduled change is undone before it starts; a cancelled row never applies. */
    cancelledAt: timestamp('cancelled_at', tz),
    cancelledBy: uuid('cancelled_by'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('billing_tax_rates_effective_idx').on(t.effectiveFrom),
    check(
      'billing_tax_rates_rate_ck',
      sql`${t.rateBp} >= 0 AND ${t.rateBp} <= 10000`
    ),
    check(
      'billing_tax_rates_none_ck',
      sql`${t.mode} <> 'none' OR ${t.rateBp} = 0`
    ),
    check('billing_tax_rates_notice_ck', sql`${t.noticeDays} >= 0`),
  ]
);

export type BillingTaxRate = InferSelectModel<typeof BillingTaxRateModel>;
export type BillingTaxMode = BillingTaxRate['mode'];
