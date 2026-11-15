import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
import type {
  InvoiceParty,
  PaymentLines,
} from '../types/subscriptionPayment.types';
import { CouponModel } from './coupon.model';
import { SubscriptionModel } from './ownerSubscription.model';
import { ownerTypeEnum } from './subscription.model';
import { SubscriptionMandateModel } from './subscriptionMandate.model';
import { billingTaxModeEnum } from './taxRate.model';

export const subscriptionPaymentKindEnum = pgEnum('subscription_payment_kind', [
  'plan_purchase',
  'plan_change',
  'addon_purchase',
  'renewal',
  'mandate_setup',
  'manual_adjustment',
  'credit_purchase',
]);

/** `pending` = sent to the bank, result not known yet. */
export const subscriptionPaymentStatusEnum = pgEnum(
  'subscription_payment_status',
  ['created', 'pending', 'captured', 'failed', 'abandoned', 'refunded']
);

export const subscriptionInvoiceStatusEnum = pgEnum(
  'subscription_invoice_status',
  ['issued', 'void']
);

const tz = { withTimezone: true } as const;
const paise = (name: string) => bigint(name, { mode: 'number' });

/** Every checkout and charge, written before the Razorpay order so our DB is the record. Never deleted. */
export const SubscriptionPaymentModel = pgTable(
  'subscription_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** Set on capture when the payment starts a new subscription. */
    subscriptionId: uuid('subscription_id').references(
      () => SubscriptionModel.id
    ),
    kind: subscriptionPaymentKindEnum('kind').notNull(),
    status: subscriptionPaymentStatusEnum('status')
      .default('created')
      .notNull(),
    amountPaise: paise('amount_paise').notNull(),
    discountPaise: paise('discount_paise').default(0).notNull(),
    /** GST frozen when the payment was priced; rows before dynamic GST were 18% inclusive. */
    taxRateBp: integer('tax_rate_bp').default(1800).notNull(),
    taxMode: billingTaxModeEnum('tax_mode').default('inclusive').notNull(),
    currency: varchar('currency', { length: 8 }).default('INR').notNull(),
    /** A captured payment with a coupon is one use of it. */
    couponId: integer('coupon_id').references(() => CouponModel.id),
    lines: jsonb('lines').$type<PaymentLines>().notNull(),
    periodStart: timestamp('period_start', tz),
    periodEnd: timestamp('period_end', tz),
    /** Empty for ₹0 and manual_adjustment rows. */
    provider: varchar('provider', { length: 20 }),
    providerOrderId: varchar('provider_order_id', { length: 255 }).unique(),
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    /** card / upi / netbanking / wallet — never card, UPI or bank details. */
    paymentMethod: varchar('payment_method', { length: 20 }),
    mandateId: uuid('mandate_id').references(() => SubscriptionMandateModel.id),
    /** One per checkout attempt, sent by the frontend: the same key returns the same order. */
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    /** Captured but a duplicate, so not applied; refunded automatically. */
    needsRefund: boolean('needs_refund').default(false).notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', tz),
    failureReason: varchar('failure_reason', { length: 255 }),
    /** Why a Super Admin made a manual_adjustment, and who. */
    reason: varchar('reason', { length: 255 }),
    doneBy: uuid('done_by'),
    paidAt: timestamp('paid_at', tz),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('subscription_payments_owner_created_idx').on(
      t.ownerType,
      t.ownerId,
      t.createdAt
    ),
    index('subscription_payments_subscription_idx').on(t.subscriptionId),
    index('subscription_payments_mandate_idx').on(t.mandateId),
    index('subscription_payments_status_next_attempt_idx').on(
      t.status,
      t.nextAttemptAt
    ),
    index('subscription_payments_coupon_owner_idx').on(
      t.couponId,
      t.ownerType,
      t.ownerId
    ),
    uniqueIndex('subscription_payments_provider_payment_unique')
      .on(t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    uniqueIndex('subscription_payments_idempotency_unique').on(
      t.ownerType,
      t.ownerId,
      t.idempotencyKey
    ),
    // Two tabs or a second checkout can never both stay open for the same owner.
    uniqueIndex('subscription_payments_one_open_checkout')
      .on(t.ownerType, t.ownerId)
      .where(
        sql`${t.status} IN ('created', 'pending') AND ${t.kind} IN ('plan_purchase', 'plan_change', 'addon_purchase')`
      ),
    // One period can't be charged twice; abandoned, failed and refunded duplicates don't count.
    uniqueIndex('subscription_payments_one_renewal_per_period')
      .on(t.subscriptionId, t.periodStart)
      .where(
        sql`${t.kind} = 'renewal' AND ${t.status} NOT IN ('abandoned', 'failed', 'refunded') AND NOT ${t.needsRefund}`
      ),
    check('subscription_payments_amount_ck', sql`${t.amountPaise} >= 0`),
    check('subscription_payments_discount_ck', sql`${t.discountPaise} >= 0`),
    check(
      'subscription_payments_manual_ck',
      sql`${t.kind} <> 'manual_adjustment' OR (${t.amountPaise} = 0 AND ${t.reason} IS NOT NULL AND ${t.doneBy} IS NOT NULL)`
    ),
  ]
);

/** Issued once when a sale is captured; never rebuilt, edited or deleted. */
export const SubscriptionInvoiceModel = pgTable(
  'subscription_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .unique()
      .references(() => SubscriptionPaymentModel.id),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 40 }).notNull().unique(),
    /** e.g. "2026-27"; the number series restarts each financial year. */
    financialYear: varchar('financial_year', { length: 7 }).notNull(),
    status: subscriptionInvoiceStatusEnum('status').default('issued').notNull(),
    issueDate: date('issue_date').notNull(),
    seller: jsonb('seller').$type<InvoiceParty>().notNull(),
    billTo: jsonb('bill_to').$type<InvoiceParty>().notNull(),
    /** Owner's GST state code: same state as ours → CGST + SGST, otherwise IGST. */
    placeOfSupply: varchar('place_of_supply', { length: 2 }).notNull(),
    sacCode: varchar('sac_code', { length: 10 }).notNull(),
    currency: varchar('currency', { length: 8 }).default('INR').notNull(),
    /** Copied from the payment, so the invoice shows the rate it was taxed at. */
    taxRateBp: integer('tax_rate_bp').default(1800).notNull(),
    taxMode: billingTaxModeEnum('tax_mode').default('inclusive').notNull(),
    taxablePaise: paise('taxable_paise').notNull(),
    cgstPaise: paise('cgst_paise').default(0).notNull(),
    sgstPaise: paise('sgst_paise').default(0).notNull(),
    igstPaise: paise('igst_paise').default(0).notNull(),
    totalPaise: paise('total_paise').notNull(),
    pdfKey: varchar('pdf_key', { length: 255 }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('subscription_invoices_owner_issue_idx').on(
      t.ownerType,
      t.ownerId,
      t.issueDate
    ),
    check(
      'subscription_invoices_amounts_ck',
      sql`${t.taxablePaise} >= 0 AND ${t.cgstPaise} >= 0 AND ${t.sgstPaise} >= 0 AND ${t.igstPaise} >= 0`
    ),
    check(
      'subscription_invoices_total_ck',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
  ]
);

/** Row-locked in the payment transaction, so invoice numbers run with no gaps (a Postgres sequence can skip). */
export const SubscriptionInvoiceSequenceModel = pgTable(
  'subscription_invoice_sequences',
  {
    financialYear: varchar('financial_year', { length: 7 }).primaryKey(),
    lastNumber: integer('last_number').default(0).notNull(),
    /** Credit notes run in their own gap-free series per year. */
    lastCreditNote: integer('last_credit_note').default(0).notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  }
);

/** Issued when a paid sale is refunded; reverses its invoice. Never edited or deleted. */
export const SubscriptionCreditNoteModel = pgTable(
  'subscription_credit_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .unique()
      .references(() => SubscriptionInvoiceModel.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => SubscriptionPaymentModel.id),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    creditNoteNumber: varchar('credit_note_number', { length: 40 })
      .notNull()
      .unique(),
    financialYear: varchar('financial_year', { length: 7 }).notNull(),
    issueDate: date('issue_date').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    taxablePaise: paise('taxable_paise').notNull(),
    cgstPaise: paise('cgst_paise').default(0).notNull(),
    sgstPaise: paise('sgst_paise').default(0).notNull(),
    igstPaise: paise('igst_paise').default(0).notNull(),
    totalPaise: paise('total_paise').notNull(),
    pdfKey: varchar('pdf_key', { length: 255 }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('subscription_credit_notes_owner_idx').on(t.ownerType, t.ownerId),
    check(
      'subscription_credit_notes_total_ck',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`
    ),
  ]
);

export type SubscriptionPayment = InferSelectModel<
  typeof SubscriptionPaymentModel
>;
export type NewSubscriptionPayment = InferInsertModel<
  typeof SubscriptionPaymentModel
>;
export type SubscriptionInvoice = InferSelectModel<
  typeof SubscriptionInvoiceModel
>;
export type NewSubscriptionInvoice = InferInsertModel<
  typeof SubscriptionInvoiceModel
>;
