import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const subscriptionWebhookEventStatusEnum = pgEnum(
  'subscription_webhook_event_status',
  ['received', 'processing', 'processed', 'failed']
);

const tz = { withTimezone: true } as const;

/** The payload holds customer email and phone, so it is cleared 90 days after processing. */
export const SubscriptionWebhookEventModel = pgTable(
  'subscription_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 20 }).default('razorpay').notNull(),
    /** `x-razorpay-event-id`: a repeat delivery of the same event is ignored. */
    eventId: varchar('event_id', { length: 255 }).notNull().unique(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: subscriptionWebhookEventStatusEnum('status')
      .default('received')
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', tz),
    error: text('error'),
    receivedAt: timestamp('received_at', tz).defaultNow().notNull(),
    processedAt: timestamp('processed_at', tz),
  },
  (t) => [
    // The worker claims an event with one conditional update, so two servers never take the same one.
    index('subscription_webhook_events_status_next_attempt_idx').on(
      t.status,
      t.nextAttemptAt
    ),
  ]
);

export type SubscriptionWebhookEvent = InferSelectModel<
  typeof SubscriptionWebhookEventModel
>;
export type NewSubscriptionWebhookEvent = InferInsertModel<
  typeof SubscriptionWebhookEventModel
>;
