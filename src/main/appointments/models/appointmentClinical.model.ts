import { pgTable, uuid, timestamp, text, json } from 'drizzle-orm/pg-core';
import { AppointmentModel, commonSymptomsEnum } from './appointment.model';

/**
 * Appointment Clinical Model
 * Stores clinical/medical data associated with an appointment.
 * One-to-one relationship with AppointmentModel.
 */
export const AppointmentClinicalModel = pgTable('appointment_clinical_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .references(() => AppointmentModel.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  commonSymptoms: commonSymptomsEnum('common_symptoms').array().default([]),
  clinicSymptomIds: uuid('clinic_symptom_ids').array().default([]),
  appointmentNotes: text('appointment_notes'),
  vitals: json('vitals_list'),
  referrals: json('referrals'),
  consentNotes: text('consent_notes'),
  consentFile: text('consent_file'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
