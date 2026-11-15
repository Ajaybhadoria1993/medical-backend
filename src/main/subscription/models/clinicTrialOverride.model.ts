import {
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** A Super Admin's own free-trial length for one clinic; without a row the trial plan's days apply. */
export const ClinicTrialOverrideModel = pgTable('clinic_trial_overrides', {
  /** No foreign key: the module keeps only the clinic's id. */
  clinicId: uuid('clinic_id').primaryKey(),
  trialDays: integer('trial_days').notNull(),
  setBy: uuid('set_by').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type ClinicTrialOverride = typeof ClinicTrialOverrideModel.$inferSelect;
