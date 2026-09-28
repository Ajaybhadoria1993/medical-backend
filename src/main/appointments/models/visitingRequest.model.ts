import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from './appointment.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ReportCardModel } from '../../reports/models/reports.model';

export const visitingRequestStatusEnum = pgEnum('visiting_request_status', [
  'Pending',
  'Scheduled',
  'Cancelled',
]);

/**
 * One row per doctor-suggested follow-up date (`ReportCardModel.visitingDays`
 * entry), so each date can be tracked/booked independently instead of living
 * only as a display string in the report card's array column.
 */
export const VisitingRequestModel = pgTable(
  'visiting_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceAppointmentId: uuid('source_appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    reportCardId: uuid('report_card_id').references(() => ReportCardModel.id),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id)
      .notNull(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id)
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    requestedDate: timestamp('requested_date').notNull(),
    status: visitingRequestStatusEnum('status').default('Pending').notNull(),
    generatedAppointmentId: uuid('generated_appointment_id').references(
      () => AppointmentModel.id
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // Upsert target for the report-card save hook: re-saving the same
    // source appointment's visiting days updates the existing row per date
    // instead of duplicating it.
    uniqueIndex('visiting_requests_source_date_unique').on(
      table.sourceAppointmentId,
      table.requestedDate
    ),
    index('visiting_requests_clinic_status_idx').on(
      table.clinicId,
      table.status
    ),
    index('visiting_requests_doctor_date_idx').on(
      table.doctorId,
      table.requestedDate
    ),
    index('visiting_requests_generated_appointment_idx').on(
      table.generatedAppointmentId
    ),
  ]
);
