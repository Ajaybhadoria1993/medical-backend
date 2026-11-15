import {
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { notificationTenantTypeEnum } from './notifications.model';
import type { WhatsAppMessageOverrides } from '../types/whatsappMessagePrefs.types';

// One row per owner, created on the Admin's first save; no row means every message is on.
export const WhatsAppMessagePrefsModel = pgTable(
  'whatsapp_message_prefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerType: notificationTenantTypeEnum('owner_type').notNull(),
    // No FK so the lab/pharmacy split needs no table change.
    ownerId: uuid('owner_id').notNull(),
    overrides: jsonb('overrides')
      .$type<WhatsAppMessageOverrides>()
      .default({})
      .notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('whatsapp_message_prefs_owner_unique').on(
      table.ownerType,
      table.ownerId
    ),
  ]
);
