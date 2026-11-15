import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// One row per message Super Admin turned off for every clinic; no rows means none are blocked.
export const WhatsAppPlatformOffsModel = pgTable('whatsapp_platform_offs', {
  messageKey: varchar('message_key', { length: 64 }).primaryKey(),
  turnedOffBy: uuid('turned_off_by'),
  turnedOffAt: timestamp('turned_off_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
