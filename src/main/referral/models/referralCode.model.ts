import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type ReferralCode = InferSelectModel<typeof ReferralCodesModel>;
export type NewReferralCode = InferInsertModel<typeof ReferralCodesModel>;

/** One fixed, shareable code per Admin or Doctor; any number of signups may use it.
 *  No FK to users/clinics/labs (module boundary). */
export const ReferralCodesModel = pgTable('referral_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Short and human-readable, e.g. `MEDI-7KQ2`. */
  code: varchar('code', { length: 20 }).notNull().unique(),
  ownerUserId: uuid('owner_user_id').notNull().unique(),
  clinicId: uuid('clinic_id'),
  labId: uuid('lab_id'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
