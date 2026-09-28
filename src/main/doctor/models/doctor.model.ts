import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

export const DoctorQualificationModel = pgTable(
  'doctor_qualifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    qualificationType: varchar('qualification_type', { length: 100 }).notNull(),
    qualificationTitle: varchar('qualification_title', {
      length: 100,
    }).notNull(),
    specialization: varchar('specialization', { length: 100 }),
    boardOrUniversity: varchar('board_or_university', { length: 150 }),
    yearOfCompletion: integer('year_of_completion'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Unique per user, qualification title + specialization
    uniqueIndex('ux_doctor_qualification_user').on(
      table.userId,
      table.qualificationTitle,
      table.specialization
    ),
  ]
);

export const doctorPrescriptionTypeModel = pgTable('doctor_prescription_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .notNull()
    .references(() => UserModel.id, { onDelete: 'cascade' }),
  prescriptionType: varchar('prescription_type', { length: 20 }),
});

export const DoctorFavoriteModel = pgTable(
  'doctor_favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    uniqueIndex('ux_doctor_favorite_patient_doctor').on(
      table.patientId,
      table.doctorId
    ),
  ]
);
