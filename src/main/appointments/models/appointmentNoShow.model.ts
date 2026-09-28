import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  json,
} from 'drizzle-orm/pg-core';

import { AppointmentModel } from './appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { index } from 'drizzle-orm/pg-core';
export const markedByRoleEnum = pgEnum('marked_by_role', [
  'doctor',
  'receptionist',
  'system',
  'admin',
]);

export const actionTakenEnum = pgEnum('action_taken', [
  'warning',
  'penalty',
  'advance_required',
  'blocked',
]);
export const AppointmentNoShowActionModel = pgTable(
  'appointment_no_show_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),

    patientId: uuid('patient_id')
      .references(() => UserModel.id)
      .notNull(),

    doctorId: uuid('doctor_id').references(() => UserModel.id),

    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),

    markedByRole: markedByRoleEnum('marked_by_role').notNull(),

    markedByUserId: uuid('marked_by_user_id').references(() => UserModel.id),

    reason: text('reason'),

    policySnapshot: json('policy_snapshot'),

    actionTaken: actionTakenEnum('action_taken').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    noShowPatientIdx: index('no_show_patient_idx').on(table.patientId),
    noShowAppointmentIdx: index('no_show_appointment_idx').on(
      table.appointmentId
    ),
  })
);
