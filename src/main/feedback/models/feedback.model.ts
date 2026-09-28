// db/tables/feedbacks.ts
import {
  pgTable,
  integer,
  text,
  varchar,
  timestamp,
  boolean,
  uuid,
  jsonb,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';

export const FeedbackModel = pgTable('feedbacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => ClinicModel.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => UserModel.id, {
    onDelete: 'cascade',
  }),
  doctorId: uuid('doctor_id').references(() => UserModel.id, {
    onDelete: 'cascade',
  }),
  appointmentId: uuid('appointment_id').references(() => AppointmentModel.id, {
    onDelete: 'cascade',
  }),

  // rating 1..5 (we'll add DB CHECK in migration)
  rating: integer('rating').notNull(),

  // free-form comment
  comments: text('comments'),

  // attachments metadata: [{ url, type, key, size }]
  attachments: text('attachments').array(),

  // user choice for anonymity
  isAnonymous: boolean('is_anonymous').notNull().default(false),

  // moderation / workflow
  status: varchar('status', { length: 32 }).notNull().default('new'), // new | reviewed | resolved | dismissed
  tags: jsonb('tags').array(), // optional small tag array, e.g. ["staff", "wait-time"]

  // staff response (optional)
  response: text('response'),
  responseBy: uuid('response_by').references(() => UserModel.id, {
    onDelete: 'cascade',
  }),
  responseAt: timestamp('response_at'),

  // timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
