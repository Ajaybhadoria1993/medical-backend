import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  varchar,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from './clinic.model';

export const ClinicBankHistoryModel = pgTable('clinic_bank_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id, { onDelete: 'cascade' })
    .notNull(),
  linkedAccountId: uuid('linked_account_id'),
  providerLinkedAccountId: varchar('provider_linked_account_id', {
    length: 255,
  }).notNull(),
  beneficiaryName: varchar('beneficiary_name', { length: 255 }),
  bankName: varchar('bank_name', { length: 255 }),
  maskedAccountNumber: varchar('masked_account_number', { length: 255 }),
  ifscCode: varchar('ifsc_code', { length: 100 }),
  effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
  effectiveTo: timestamp('effective_to'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
