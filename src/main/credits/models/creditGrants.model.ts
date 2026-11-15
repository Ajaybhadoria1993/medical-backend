import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const creditGrantSourceEnum = pgEnum('credit_grant_source', [
  'grant',
  'removal',
  'purchase',
]);

export type CreditGrant = InferSelectModel<typeof CreditGrantsModel>;
export type NewCreditGrant = InferInsertModel<typeof CreditGrantsModel>;

/** A clinic's credits: one row per Super Admin grant, plus one per removal as its record.
 *  No FK to clinics/users (module boundary), so history outlives a deleted clinic. */
export const CreditGrantsModel = pgTable(
  'credit_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    /** A CREDIT_TYPES value, e.g. `whatsapp`. */
    creditType: varchar('credit_type', { length: 30 }).notNull(),
    source: creditGrantSourceEnum('source').notNull(),
    /** Credits granted, or credits removed on a removal row. */
    creditsTotal: integer('credits_total').notNull(),
    /** Always 0 on a removal row. */
    creditsLeft: integer('credits_left').notNull(),
    /** The Super Admin who granted or removed; null on a clinic's own purchase. */
    grantedBy: uuid('granted_by'),
    /** The subscription payment a purchase came from; unique, so a payment adds credits once. */
    paymentId: uuid('payment_id'),
    reason: varchar('reason', { length: 255 }).notNull(),
    /** On a removal row this is the time of the removal. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    expiryRemindedAt: timestamp('expiry_reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Balance and oldest-first reads only ever touch grants with credits left.
    index('credit_grants_live_idx')
      .on(table.clinicId, table.creditType, table.expiresAt)
      .where(sql`credits_left > 0`),
    uniqueIndex('credit_grants_payment_unique')
      .on(table.paymentId)
      .where(sql`payment_id IS NOT NULL`),
    // ::text keeps the rule off the enum, so it can ship in the migration that adds 'purchase'.
    check(
      'credit_grants_source_ck',
      sql`(${table.source}::text = 'purchase' AND ${table.paymentId} IS NOT NULL AND ${table.grantedBy} IS NULL) OR (${table.source}::text <> 'purchase' AND ${table.grantedBy} IS NOT NULL)`
    ),
  ]
);
