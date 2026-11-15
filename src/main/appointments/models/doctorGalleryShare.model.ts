import {
  pgTable,
  timestamp,
  uuid,
  text,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from './appointment.model';
import { doctorGallery } from './doctorGallery.model';
import { SHARE_NOTE_MAX_LENGTH } from '../schemas/galleryShare.schemas';

// One image shared with the patient of one appointment.
// galleryImageId is set for My Uploads, null for a system Suggested image.
export const doctorGalleryShare = pgTable(
  'doctor_gallery_share',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    galleryImageId: uuid('gallery_image_id').references(
      () => doctorGallery.id,
      { onDelete: 'cascade' }
    ),
    imageUrl: text('image_url').notNull(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    note: varchar('note', { length: SHARE_NOTE_MAX_LENGTH }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('doctor_gallery_share_appointment_image_uq').on(
      table.appointmentId,
      table.imageUrl
    ),
    index('doctor_gallery_share_patient_idx').on(table.patientId),
  ]
);
