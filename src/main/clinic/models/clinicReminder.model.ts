import {
  pgTable,
  uuid,
  integer,
  timestamp,
  boolean,
  pgEnum,
  varchar,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from './clinic.model';

export const reminderTimeUnitEnum = pgEnum('reminder_time_unit', [
  'Minutes',
  'Hours',
  'Days',
]);

export const ClinicReminderModel = pgTable('clinic_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),

  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id)
    .notNull(),

  timeValue: integer('time_value').notNull(),

  timeUnit: reminderTimeUnitEnum('time_unit').default('Hours').notNull(),

  reminderType: varchar('reminder_type', { length: 50 })
    .default('Appointment')
    .notNull(),

  isActive: boolean('is_active').default(true).notNull(),

  deletedAt: timestamp('deleted_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow(),
});
