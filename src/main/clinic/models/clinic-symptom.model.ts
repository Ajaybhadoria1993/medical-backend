// clinic-symptom.model.ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from './clinic.model';

export const clinicSymptomStatusEnum = pgEnum('clinic_symptom_status', [
  'Active',
  'Inactive',
]);

export const ClinicSymptomModel = pgTable('clinic_symptoms', {
  id: uuid('id').primaryKey().defaultRandom(),

  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id)
    .notNull(),

  name: varchar('name', { length: 150 }).notNull(),

  description: text('description'),

  status: clinicSymptomStatusEnum('status').default('Active').notNull(),

  isDeleted: boolean('is_deleted').default(false).notNull(),

  deletedAt: timestamp('deleted_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow(),
});
