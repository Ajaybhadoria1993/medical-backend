import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ReferralCodesModel } from './referralCode.model';

/** signed_up → joined (Super Admin approves the clinic) → paid (first paid plan). */
export const referralSignupStatusEnum = pgEnum('referral_signup_status', [
  'signed_up',
  'joined',
  'paid',
]);

export type ReferralSignup = InferSelectModel<typeof ReferralSignupsModel>;
export type NewReferralSignup = InferInsertModel<typeof ReferralSignupsModel>;

/** One row per user who signed up with a code. Only joined and paid rows count.
 *  No FK to users/clinics (module boundary). */
export const ReferralSignupsModel = pgTable(
  'referral_signups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => ReferralCodesModel.id),
    referrerUserId: uuid('referrer_user_id').notNull(),
    /** Unique: a user is counted for one referrer, once. */
    referredUserId: uuid('referred_user_id').notNull().unique(),
    referredClinicId: uuid('referred_clinic_id'),
    status: referralSignupStatusEnum('status').default('signed_up').notNull(),
    signedUpAt: timestamp('signed_up_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** When a Super Admin approved the clinic. */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    index('referral_signups_referrer_idx').on(
      table.referrerUserId,
      table.signedUpAt
    ),
    index('referral_signups_signed_up_at_idx').on(table.signedUpAt),
  ]
);
