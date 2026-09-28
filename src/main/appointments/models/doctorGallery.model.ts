import { pgTable, timestamp, uuid, text } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

export const doctorGallery = pgTable('doctor_gallery', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .references(() => UserModel.id, { onDelete: 'cascade' })
    .notNull(),
  imageUrl: text('image_url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
