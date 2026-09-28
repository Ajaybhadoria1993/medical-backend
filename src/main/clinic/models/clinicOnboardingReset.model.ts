import { pgTable, uuid, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { ClinicModel } from './clinic.model';
import { UserModel } from '../../users/models/user.model';

// Audit trail for super-admin onboarding resets: a reset sends a live clinic
// back to the setup wizard, so "who did this and why" has to survive it.
export const ClinicOnboardingResetModel = pgTable(
  'clinic_onboarding_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    performedBy: uuid('performed_by')
      .references(() => UserModel.id)
      .notNull(),
    reason: varchar('reason', { length: 500 }),
    resetAt: timestamp('reset_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_clinic_onboarding_resets_clinic').on(
      table.clinicId,
      table.resetAt
    ),
  ]
);
