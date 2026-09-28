// src/models/access.models.ts
import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

// permission types (string identifiers)
export const SettingModel = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => UserModel.id)
      .notNull(),
    /**
     * @deprecated Superseded by the Notification Center rebuild.
     *
     * **No delivery path consults these.** Per-event, per-channel switches live
     * in `notificationPreferences` below; clinic-wide channel toggles live on
     * the clinic settings row. What keeps them alive is only the settings API:
     * `updateSetting` still accepts them in its payload and echoes them back,
     * so a client can still write a value that changes nothing. Retiring that
     * write path is the first step, before the columns themselves.
     *
     * **Deliberately not dropped** (Phase 9). They are `notNull` with defaults,
     * so they cost a boolean per settings row and nothing else, while dropping
     * them is irreversible and would break any deploy still running the previous
     * image mid-rollout. Drop them in a later migration, once nothing writes
     * them and no deployed version selects them — not as part of this rebuild.
     */
    emailNotification: boolean('email_notification').default(false).notNull(),
    /** @deprecated See emailNotification above. */
    smsNotification: boolean('sms_notification').default(false).notNull(),
    /** @deprecated See emailNotification above. */
    whatsappNotification: boolean('whatsapp_notification')
      .default(false)
      .notNull(),
    /** @deprecated See emailNotification above. */
    appointmentReminder: integer('appointment_reminder').default(1).notNull(),
    notificationPreferences: jsonb('notification_preferences'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('setting_unique').on(table.userId)]
);
