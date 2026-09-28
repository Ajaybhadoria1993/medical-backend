import { pgTable, timestamp, uuid, text } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from './appointment.model';

export const patientGallery = pgTable('patient_gallery', {
  id: uuid('id').primaryKey().defaultRandom(),
  appointmentId: uuid('appointment_id')
    .references(() => AppointmentModel.id, { onDelete: 'cascade' })
    .notNull(),
  patientId: uuid('patient_id')
    .references(() => UserModel.id, { onDelete: 'cascade' })
    .notNull(),
  doctorId: uuid('doctor_id')
    .references(() => UserModel.id, { onDelete: 'cascade' })
    .notNull(),
  imageUrl: text('image_url').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
