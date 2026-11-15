import type { InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ownerTypeEnum } from './subscription.model';
import { SubscriptionPaymentModel } from './subscriptionPayment.model';

export const billingMismatchKindEnum = pgEnum('billing_mismatch_kind', [
  // Captured at Razorpay, never applied by us.
  'not_applied',
  // We applied it, Razorpay says refunded or failed.
  'state_differs',
  // Captured amount is not what we charged.
  'amount_differs',
  // We owe a refund that has not gone through for 2 days.
  'refund_stuck',
  // Paid next month for an add-on, then that month was never paid: refund it by hand.
  'refund_owed',
]);

export const billingMismatchStatusEnum = pgEnum('billing_mismatch_status', [
  'open',
  'resolved',
]);

const tz = { withTimezone: true } as const;

/** Differences between our payments and Razorpay found by the daily match job; kept as history. */
export const BillingMismatchModel = pgTable(
  'billing_mismatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: billingMismatchKindEnum('kind').notNull(),
    status: billingMismatchStatusEnum('status').default('open').notNull(),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    paymentId: uuid('payment_id').references(() => SubscriptionPaymentModel.id),
    providerOrderId: varchar('provider_order_id', { length: 255 }),
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    /** What each side says, e.g. { status, amountPaise }. */
    ours: jsonb('ours').$type<Record<string, unknown>>().notNull(),
    theirs: jsonb('theirs').$type<Record<string, unknown>>().notNull(),
    detectedAt: timestamp('detected_at', tz).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', tz).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', tz),
    /** Null when the job found it matched on a later run. */
    resolvedBy: uuid('resolved_by'),
    resolution: varchar('resolution', { length: 500 }),
  },
  (t) => [
    // One open row per difference; a rerun updates last_seen_at instead of adding another.
    uniqueIndex('billing_mismatches_one_open')
      .on(t.kind, t.paymentId)
      .where(sql`${t.status} = 'open'`),
    index('billing_mismatches_status_idx').on(t.status, t.detectedAt),
    index('billing_mismatches_owner_idx').on(t.ownerType, t.ownerId),
  ]
);

export type BillingMismatch = InferSelectModel<typeof BillingMismatchModel>;
