import {
  boolean,
  decimal,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export type CreditPack = InferSelectModel<typeof CreditPackModel>;
export type NewCreditPack = InferInsertModel<typeof CreditPackModel>;

/** Credit packs clinics will be able to buy, managed by Super Admin.
 *  Switched off instead of deleted; a purchase will copy credits and price. */
export const CreditPackModel = pgTable(
  'credit_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** A CREDIT_TYPES value, e.g. `whatsapp`. */
    creditType: varchar('credit_type', { length: 30 }).notNull(),
    credits: integer('credits').notNull(),
    /** What the clinic pays, GST included. */
    priceInr: decimal('price_inr', { precision: 10, scale: 2 }).notNull(),
    active: boolean('active').default(true).notNull(),
    /** Lower shows first. */
    sortOrder: integer('sort_order').default(0).notNull(),
    /** Super Admin who last changed it; null only on the seeded defaults. */
    changedBy: uuid('changed_by'),
    /** Why it was last changed. */
    reason: varchar('reason', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('credit_packs_type_credits_unique').on(
      table.creditType,
      table.credits
    ),
  ]
);
