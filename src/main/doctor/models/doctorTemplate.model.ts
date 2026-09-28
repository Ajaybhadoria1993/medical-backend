import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

export const doctorTemplateModel = pgTable('doctor_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .notNull()
    .references(() => UserModel.id, { onDelete: 'cascade' }),
  templateHtml: text('template_html'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
