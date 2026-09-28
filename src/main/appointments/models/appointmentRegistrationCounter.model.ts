import {
  pgTable,
  uuid,
  integer,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/** Last appointment registration number issued to each doctor in a clinic.
 * Bumped by AppointmentRegistrationService inside the booking transaction. */
export const AppointmentRegistrationCounterModel = pgTable(
  'appointment_registration_counters',
  {
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    lastNo: integer('last_no').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.clinicId, table.doctorId] })]
);
