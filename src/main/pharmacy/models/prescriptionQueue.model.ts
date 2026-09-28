import { pgTable, uuid, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { ReportCardModel } from '../../reports/models/reports.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';

export const prescriptionStatusEnum = pgEnum('prescription_status', [
  'PENDING',
  'ON_HOLD',
  'COMPLETED',
  'REJECTED',
]);

export const PrescriptionQueueModel = pgTable(
  'prescription_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id').references(() => ReportCardModel.id),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id)
      .notNull(),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id)
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    pharmacyUserId: uuid('pharmacy_user_id').references(() => UserModel.id),
    status: prescriptionStatusEnum('status').default('PENDING').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('prescription_queue_clinic_status_idx').on(
      table.clinicId,
      table.status
    ),
    index('prescription_queue_appointment_id_idx').on(table.appointmentId),
    index('prescription_queue_doctor_id_idx').on(table.doctorId),
  ]
);
