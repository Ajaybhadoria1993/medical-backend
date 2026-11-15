import {
  decimal,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export type CreditSettings = InferSelectModel<typeof CreditSettingsModel>;
export type NewCreditSettings = InferInsertModel<typeof CreditSettingsModel>;

/** Versioned settings per credit type: a change adds a row, old rows stay as history.
 *  The row in force is the latest one whose effective_from has passed. */
export const CreditSettingsModel = pgTable(
  'credit_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** A CREDIT_TYPES value, e.g. `whatsapp`. */
    creditType: varchar('credit_type', { length: 30 }).notNull(),
    expiryDays: integer('expiry_days').notNull(),
    /** 0 = no expiry reminder. */
    reminderDays: integer('reminder_days').notNull(),
    warnPercent: integer('warn_percent').notNull(),
    /** Supplier price per unit before tax, e.g. Meta's ₹0.1150. */
    unitCostInr: decimal('unit_cost_inr', {
      precision: 10,
      scale: 4,
    }).notNull(),
    taxPercent: decimal('tax_percent', { precision: 5, scale: 2 }).notNull(),
    /** A future value schedules the change. */
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    /** Super Admin who made the change; null only on the seeded defaults. */
    changedBy: uuid('changed_by'),
    reason: varchar('reason', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('credit_settings_type_from_unique').on(
      table.creditType,
      table.effectiveFrom
    ),
  ]
);
