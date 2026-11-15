import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  decimal,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { CreditGrantsModel } from './creditGrants.model';

export const messagePaidWithEnum = pgEnum('message_paid_with', [
  'unlimited',
  'plan',
  'credit',
]);

export type MessageLog = InferSelectModel<typeof MessageLogModel>;
export type NewMessageLog = InferInsertModel<typeof MessageLogModel>;

/** One row per message Meta accepted: the free-message counter and the cost record.
 *  Never holds a phone number or patient data. */
export const MessageLogModel = pgTable(
  'messaging_message_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    /** A CREDIT_TYPES value, e.g. `whatsapp`. */
    channel: varchar('channel', { length: 30 }).notNull(),
    /** Meta's id; unique so a delivery report finds exactly one row. */
    messageId: varchar('message_id', { length: 128 }).notNull().unique(),
    templateKey: varchar('template_key', { length: 64 }).notNull(),
    paidWith: messagePaidWithEnum('paid_with').notNull(),
    /** The grant that paid, so a refund returns the credit to it. */
    creditGrantId: uuid('credit_grant_id').references(
      () => CreditGrantsModel.id
    ),
    /** Null until Meta's delivery report arrives. */
    billable: boolean('billable'),
    costInr: decimal('cost_inr', { precision: 10, scale: 4 }),
    /** Set when Meta didn't charge us, so the clinic gets the message back; set once only. */
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Serves the free-message count: unrefunded plan-paid rows since the period start.
    index('messaging_message_log_plan_usage_idx')
      .on(table.clinicId, table.channel, table.sentAt)
      .where(sql`paid_with = 'plan' AND refunded_at IS NULL`),
  ]
);
