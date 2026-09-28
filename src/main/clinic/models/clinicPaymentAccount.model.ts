import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { ClinicModel } from './clinic.model';

/**
 * Clinic Payment Account Model
 *
 * Stores multi-gateway sub-merchant onboarding and route routing configurations.
 */
export const ClinicPaymentAccountModel = pgTable(
  'clinic_payment_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    paymentProvider: varchar('payment_provider', { length: 50 }).notNull(), // 'razorpay' | 'cashfree' | 'stripe'
    gatewayAccountId: varchar('gateway_account_id', { length: 255 }), // sub-merchant account reference ID
    gatewayStakeholderId: varchar('gateway_stakeholder_id', { length: 255 }),
    routeStatus: varchar('route_status', { length: 50 })
      .default('INACTIVE')
      .notNull(),
    routeOnboardedAt: timestamp('route_onboarded_at'),
    routeOnboardingRejectionReason: text('route_onboarding_rejection_reason'),
    onboardingDraftData: text('onboarding_draft_data'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('clinic_payment_account_clinic_provider_unique').on(
      table.clinicId,
      table.paymentProvider
    ),
  ]
);

export type ClinicPaymentAccount = InferSelectModel<
  typeof ClinicPaymentAccountModel
>;
export type NewClinicPaymentAccount = InferInsertModel<
  typeof ClinicPaymentAccountModel
>;
