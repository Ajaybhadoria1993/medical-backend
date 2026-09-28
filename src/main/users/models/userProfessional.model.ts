import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  index,
  numeric,
} from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';

/**
 * Professional details for doctors, nurses, lab assistants, etc.
 * One-to-one relationship with `users` table.
 * Only relevant for medical professional user types.
 */
export const UserProfessionalModel = pgTable(
  'user_professionals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    qualification: text('qualification'),
    yearsOfExperience: integer('years_of_experience'),
    licenseNumber: text('license_number'),
    speciality: text('speciality'),
    specialization: text('specialization').array(),
    registrationNumber: varchar('registration_number', { length: 100 }),
    about: varchar('about', { length: 1000 }),
    averageRating: numeric('average_rating', { precision: 3, scale: 2 })
      .default('0.00')
      .notNull(),
    reviewCount: integer('review_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    userIdIdx: index('user_professional_user_id_idx').on(table.userId),
    licenseIdx: index('user_professional_license_idx').on(table.licenseNumber),
  })
);
