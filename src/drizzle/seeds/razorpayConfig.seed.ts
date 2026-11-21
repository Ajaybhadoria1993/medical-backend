import { logSeed, newCounts, syncRow, tally } from './seedSync';
import { FeeConfigVersionModel } from '../../main/payment/models/feeConfigVersion.model';
import { eq, and } from 'drizzle-orm';

/** Global fee configs are versioned (SCD2): the seed only creates a missing one, never edits a live version. */
export async function seedRazorpayConfig() {
  // Typed as full rows so a new NOT NULL column fails the build, not a fresh-DB seed.
  const globalFeeConfigs: (typeof FeeConfigVersionModel.$inferInsert)[] = [
    {
      scope: 'GLOBAL',
      clinicId: null,
      version: 1,
      feeType: 'CONVENIENCE_FEE',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'CLINIC_SERVICE_PRICE',
      rateOrAmount: '2.0000', // 2.0%
      taxRate: '18.00',
      taxTreatment: 'TAX_EXCLUSIVE',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      isActive: true,
    },
    {
      scope: 'GLOBAL',
      clinicId: null,
      version: 1,
      feeType: 'CLINIC_COMMISSION',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'CLINIC_SERVICE_PRICE',
      rateOrAmount: '10.0000', // 10.0%
      taxRate: '18.00',
      taxTreatment: 'TAX_EXCLUSIVE',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      isActive: true,
    },
    {
      scope: 'GLOBAL',
      clinicId: null,
      version: 1,
      feeType: 'GATEWAY_FEE',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'PRE_GATEWAY_SUBTOTAL',
      rateOrAmount: '2.0000', // 2.0%
      taxRate: '18.00',
      taxTreatment: 'TAX_EXCLUSIVE',
      feeRecipient: 'PAYMENT_GATEWAY',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      isActive: true,
    },
  ];

  const counts = newCounts();
  const changed: string[] = [];
  for (const config of globalFeeConfigs) {
    const { result } = await syncRow({
      table: FeeConfigVersionModel,
      where: and(
        eq(FeeConfigVersionModel.scope, 'GLOBAL'),
        eq(FeeConfigVersionModel.feeType, config.feeType),
        eq(FeeConfigVersionModel.isActive, true)
      ),
      values: {} as typeof FeeConfigVersionModel.$inferInsert,
      createOnly: config,
    });
    tally(counts, changed, config.feeType, result);
  }
  logSeed('fee configs', counts, changed);
}
