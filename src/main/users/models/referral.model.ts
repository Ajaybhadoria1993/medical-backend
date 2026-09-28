// src/models/token.model.ts
import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';
import { index, uniqueIndex } from 'drizzle-orm/pg-core';

export const referralStatusEnum = pgEnum('referral_status', [
  'pending',
  'approved',
  'rejected',
]);

export const ReferralModel = pgTable(
  'referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referredTo: uuid('referred_to').references(() => UserModel.id),
    referredBy: uuid('referred_by').references(() => UserModel.id),
    referralCode: varchar('referral_code').unique().notNull(),
    status: referralStatusEnum('status').default('pending').notNull(),
    comments: varchar('comments'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('referral_referred_by_idx').on(table.referredBy),
    index('referral_referred_to_idx').on(table.referredTo),
    uniqueIndex('referral_code_unique').on(table.referralCode),
    index('referral_created_at_idx').on(table.createdAt),
    index('referral_status_idx').on(table.status), // New index for better query performance
  ]
);
