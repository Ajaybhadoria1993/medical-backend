import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ownerTypeEnum } from './subscription.model';

export const subscriptionMandateMethodEnum = pgEnum(
  'subscription_mandate_method',
  ['card', 'upi', 'emandate']
);

export const subscriptionMandateStatusEnum = pgEnum(
  'subscription_mandate_status',
  ['pending', 'active', 'paused', 'cancelled', 'failed']
);

const tz = { withTimezone: true } as const;

/** Belongs to the owner, not to a subscription row, so a plan change keeps AutoPay on. */
export const SubscriptionMandateModel = pgTable(
  'subscription_mandates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    provider: varchar('provider', { length: 20 }).default('razorpay').notNull(),
    providerCustomerId: varchar('provider_customer_id', {
      length: 255,
    }).notNull(),
    /** Set once Razorpay confirms the token. */
    providerTokenId: varchar('provider_token_id', { length: 255 }).unique(),
    method: subscriptionMandateMethodEnum('method').notNull(),
    /** The most one charge may be. */
    maxAmountPaise: bigint('max_amount_paise', { mode: 'number' }).notNull(),
    tokenExpiresAt: timestamp('token_expires_at', tz),
    status: subscriptionMandateStatusEnum('status')
      .default('pending')
      .notNull(),
    authorizedAt: timestamp('authorized_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    failureReason: varchar('failure_reason', { length: 255 }),
    createdAt: timestamp('created_at', tz).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', tz).defaultNow().notNull(),
  },
  (t) => [
    index('subscription_mandates_owner_idx').on(t.ownerType, t.ownerId),
    uniqueIndex('subscription_mandates_one_active_per_owner')
      .on(t.ownerType, t.ownerId)
      .where(sql`${t.status} = 'active'`),
    check('subscription_mandates_max_amount_ck', sql`${t.maxAmountPaise} > 0`),
  ]
);

export type SubscriptionMandate = InferSelectModel<
  typeof SubscriptionMandateModel
>;
export type NewSubscriptionMandate = InferInsertModel<
  typeof SubscriptionMandateModel
>;
