import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  boolean,
  decimal,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { ClinicModel } from '../../clinic/models/clinic.model';

/**
 * Unified Fee Configuration Version Model (SCD Type 2)
 *
 * Stores both platform-wide global defaults (scope = 'GLOBAL', clinicId = NULL)
 * and clinic-specific overrides (scope = 'CLINIC', clinicId = UUID).
 */
export const FeeConfigVersionModel = pgTable(
  'fee_config_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Scope & Clinic Association
    scope: varchar('scope', { length: 20 }).notNull(), // 'GLOBAL' or 'CLINIC'
    clinicId: uuid('clinic_id').references(() => ClinicModel.id, {
      onDelete: 'cascade',
    }), // NULL for GLOBAL

    version: integer('version').notNull(), // Incremental version sequence per scope & feeType
    feeType: varchar('fee_type', { length: 64 }).notNull(), // 'CONVENIENCE_FEE', 'CLINIC_COMMISSION', 'GATEWAY_FEE', 'ROUTE_TRANSFER_FEE'
    enabled: boolean('enabled').default(true).notNull(),

    calculationMethod: varchar('calculation_method', { length: 50 }).notNull(), // 'PERCENTAGE' | 'FIXED' | 'CLAMPED_PERCENTAGE' | 'TIERED'
    calculationBase: varchar('calculation_base', { length: 50 }).notNull(), // 'CLINIC_SERVICE_PRICE' | 'PRE_GATEWAY_SUBTOTAL' | 'TOTAL_TRANSACTION_AMOUNT'
    rateOrAmount: decimal('rate_or_amount', {
      precision: 12,
      scale: 4,
    }).notNull(),

    taxRate: decimal('tax_rate', { precision: 5, scale: 2 })
      .default('18.00')
      .notNull(),
    taxTreatment: varchar('tax_treatment', { length: 50 })
      .default('TAX_EXCLUSIVE')
      .notNull(), // 'TAX_EXEMPT' | 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE'

    feePayer: varchar('fee_payer', { length: 50 }).default('PATIENT').notNull(), // 'PATIENT' | 'CLINIC' | 'PLATFORM'
    feeRecipient: varchar('fee_recipient', { length: 50 })
      .default('PLATFORM')
      .notNull(), // 'CLINIC' | 'PLATFORM' | 'PAYMENT_GATEWAY' | 'GOVERNMENT'
    deductionStrategy: varchar('deduction_strategy', { length: 50 }).notNull(), // 'ADD_TO_PATIENT_TOTAL' | 'DEDUCT_FROM_CLINIC' | 'DEDUCT_FROM_PLATFORM'

    isActive: boolean('is_active').default(true).notNull(),
    effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
    effectiveTo: timestamp('effective_to'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('fee_config_resolution_idx').on(
      table.clinicId,
      table.feeType,
      table.isActive
    ),
    index('fee_config_scope_idx').on(table.scope, table.feeType),
  ]
);

export type FeeConfigVersion = InferSelectModel<typeof FeeConfigVersionModel>;
export type NewFeeConfigVersion = InferInsertModel<
  typeof FeeConfigVersionModel
>;
