import { sql, type InferSelectModel } from 'drizzle-orm';
import {
  check,
  decimal,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AddOnModel } from './addon.model';

const tz = { withTimezone: true } as const;

/**
 * Scheduled add-on prices. From `effective_from` new purchases and renewals pay this price;
 * before the first row starts, the price on `add_ons` applies. Rows are never edited once started.
 */
export const AddOnPriceModel = pgTable(
  'add_on_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    addOnId: uuid('add_on_id')
      .notNull()
      .references(() => AddOnModel.id),
    monthlyPrice: decimal('monthly_price', {
      precision: 12,
      scale: 2,
    }).notNull(),
    yearlyPrice: decimal('yearly_price', { precision: 12, scale: 2 }).notNull(),
    effectiveFrom: timestamp('effective_from', tz).notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    // Also serves "latest change that has started" lookups.
    uniqueIndex('add_on_prices_add_on_from_unique').on(
      t.addOnId,
      t.effectiveFrom
    ),
    check(
      'add_on_prices_prices_ck',
      sql`${t.monthlyPrice} >= 0 AND ${t.yearlyPrice} >= 0`
    ),
  ]
);

export type AddOnPrice = InferSelectModel<typeof AddOnPriceModel>;

/** The add-on price in force now: the latest started change, else the price on `add_ons`. */
export const addOnPriceNow = (cycle: 'monthly' | 'yearly') =>
  sql<string>`coalesce((
    select ${sql.raw(cycle === 'yearly' ? 'p.yearly_price' : 'p.monthly_price')}
    from add_on_prices p
    where p.add_on_id = "add_ons"."id" and p.effective_from <= now()
    order by p.effective_from desc
    limit 1
  ), ${cycle === 'yearly' ? AddOnModel.yearlyPrice : AddOnModel.monthlyPrice})`;
