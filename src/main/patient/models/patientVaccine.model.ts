import {
  date,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/**
 * patient_vaccines — one row per dose given or recorded in a clinic.
 * Read only within the clinic that recorded it; visit doses carry their appointment.
 */
export const PatientVaccineModel = pgTable(
  'patient_vaccines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    vaccine: varchar('vaccine', { length: 100 }).notNull(),
    doseNo: integer('dose_no').notNull(),
    givenOn: date('given_on').notNull(),
    givenBy: uuid('given_by').references(() => UserModel.id, {
      onDelete: 'set null',
    }),
    batch: varchar('batch', { length: 50 }),
    // Set for doses ticked on a prescription, so re-saving that visit replaces them.
    appointmentId: uuid('appointment_id').references(
      () => AppointmentModel.id,
      {
        onDelete: 'cascade',
      }
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_patient_vaccines_patient_clinic').on(
      table.patientId,
      table.clinicId
    ),
    index('idx_patient_vaccines_appointment').on(table.appointmentId),
  ]
);
