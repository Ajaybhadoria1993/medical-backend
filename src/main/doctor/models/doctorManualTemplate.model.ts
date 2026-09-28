import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { varchar } from 'drizzle-orm/pg-core';

export const doctorManualTemplateModel = pgTable('doctor_manual_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .notNull()
    .references(() => UserModel.id, { onDelete: 'cascade' }),
  templateImage: varchar('template_image', { length: 256 }),
  templateHtml: text('template_html'),
  printType: varchar('print_type', { length: 20 }).default(
    'Without Background'
  ),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
