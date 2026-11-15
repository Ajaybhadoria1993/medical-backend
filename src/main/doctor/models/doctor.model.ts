import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
  index,
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
    // Shown to patients on the public profile, e.g. "Gold medalist".
    notes: varchar('notes', { length: 300 }),
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

// Hospitals and clinics a doctor has worked at, shown as a timeline on the public profile.
export const DoctorExperienceModel = pgTable(
  'doctor_experiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    organisation: varchar('organisation', { length: 150 }).notNull(),
    role: varchar('role', { length: 100 }).notNull(),
    city: varchar('city', { length: 100 }),
    startMonth: integer('start_month').notNull(),
    startYear: integer('start_year').notNull(),
    // Both null while is_current is true.
    endMonth: integer('end_month'),
    endYear: integer('end_year'),
    isCurrent: boolean('is_current').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('doctor_experiences_user_id_idx').on(table.userId)]
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
