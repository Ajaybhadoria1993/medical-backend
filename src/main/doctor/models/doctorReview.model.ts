import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';

export const DoctorReviewsModel = pgTable(
  'doctor_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Foreign Keys
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => AppointmentModel.id, { onDelete: 'cascade' }),

    // Rating & Content
    rating: integer('rating').notNull(), // 1 to 5
    reviewText: varchar('review_text', { length: 1000 }),

    // Moderation Status
    status: varchar('status', { length: 32 }).notNull().default('approved'), // approved | pending | hidden | flagged

    // Doctor Reply/Response
    replyText: text('reply_text'),
    replyAt: timestamp('reply_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    doctorIdIdx: index('doctor_reviews_doctor_id_idx').on(table.doctorId),
    patientIdIdx: index('doctor_reviews_patient_id_idx').on(table.patientId),
    appointmentUniqueIdx: uniqueIndex('ux_doctor_reviews_appointment').on(
      table.appointmentId
    ),
  })
);
