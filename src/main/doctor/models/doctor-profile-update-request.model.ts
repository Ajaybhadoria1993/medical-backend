import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';

export const DoctorProfileUpdateRequestModel = pgTable(
  'doctor_profile_update_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id)
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    requestedData: jsonb('requested_data').notNull(),
    status: text('status').default('pending'),
    reason: text('reason'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    doctorIdIdx: index('idx_doctor_update_requests_doctor_id').on(
      table.doctorId
    ),
    statusIdx: index('idx_doctor_update_requests_status').on(table.status),
    clinicStatusIdx: index('idx_doctor_update_requests_clinic_status').on(
      table.clinicId,
      table.status
    ),
  })
);
