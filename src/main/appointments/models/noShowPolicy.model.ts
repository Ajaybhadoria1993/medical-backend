import {
  pgTable,
  uuid,
  integer,
  timestamp,
  pgEnum,
  json,
  boolean,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';

export const penaltyTypeEnum = pgEnum('penalty_type', ['fixed', 'percentage']);

export const NoShowPolicyModel = pgTable('no_show_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),

  gracePeriodMinutes: integer('grace_period_minutes').default(15).notNull(),

  rules: json('rules').default([]).notNull(),

  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
