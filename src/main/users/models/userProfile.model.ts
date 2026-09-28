import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';

/**
 * User profile — personal & contact details.
 * One-to-one relationship with `users` table.
 */
export const UserProfileModel = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    alternateMobile: varchar('alternate_mobile'),
    gender: varchar('gender'),
    address: text('address'),
    city: varchar('city'),
    state: varchar('state'),
    zipCode: varchar('zip_code', { length: 10 }),
    profileImage: text('profile_image'),
    age: integer('age'),
    dob: varchar('dob', { length: 20 }),
    upiIds: jsonb('upi_ids').$type<string[]>(),
    bloodGroup: varchar('blood_group', { length: 5 }),
    height: varchar('height', { length: 10 }),
    weight: varchar('weight', { length: 10 }),
    allergies: jsonb('allergies').$type<string[]>(),
    chronicConditions: jsonb('chronic_conditions').$type<string[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    userIdIdx: index('user_profile_user_id_idx').on(table.userId),
  })
);
