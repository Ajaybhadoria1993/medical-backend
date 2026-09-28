import { pgTable, timestamp, uuid, integer, text } from 'drizzle-orm/pg-core';
import { AppointmentModel } from './appointment.model';
const pg_core_1 = require('drizzle-orm/pg-core');

export const medicalCertificateModel = pgTable('medical_certificate', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .references(() => AppointmentModel.id, { onDelete: 'cascade' })
    .notNull(),
  medicalCondition: text('medical_condition'),
  restDays: integer('rest_days'),
  notes: (0, pg_core_1.text)('notes').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
