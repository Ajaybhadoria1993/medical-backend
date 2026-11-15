import { index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/**
 * visit_examinations — a visit's specialty exam findings (exam tabs, charts), one row per appointment.
 * Older visits still hold theirs in report_cards.additional_information; reads fall back to it.
 */
export const VisitExaminationModel = pgTable(
  'visit_examinations',
  {
    appointmentId: uuid('appointment_id')
      .primaryKey()
      .references(() => AppointmentModel.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    // Flat keys, e.g. `ear.right.canal`, `Tooth-36`; values are strings.
    findings: jsonb('findings')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_visit_examinations_patient_clinic').on(
      table.patientId,
      table.clinicId
    ),
  ]
);
