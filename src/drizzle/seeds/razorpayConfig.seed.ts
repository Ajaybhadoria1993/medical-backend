import logger from '../../utils/logger';
import { database } from '../../configurations/dbConnection';
import { FeeConfigVersionModel } from '../../main/payment/models/feeConfigVersion.model';
import { eq, and } from 'drizzle-orm';

export async function seedRazorpayConfig() {
  try {
    logger.info('🌱 Seeding SCD2 Fee Configurations...');

    // 1. Seed Global SCD2 Fee Configurations
    const globalFeeConfigs = [
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
        feePayer: 'PATIENT',
        feeRecipient: 'PLATFORM',
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
        feePayer: 'PATIENT',
        feeRecipient: 'PLATFORM',
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
        feePayer: 'PATIENT',
        feeRecipient: 'PAYMENT_GATEWAY',
        deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
        isActive: true,
      },
    ];

    for (const config of globalFeeConfigs) {
      const [existing] = await database
        .select()
        .from(FeeConfigVersionModel)
        .where(
          and(
            eq(FeeConfigVersionModel.scope, 'GLOBAL'),
            eq(FeeConfigVersionModel.feeType, config.feeType),
            eq(FeeConfigVersionModel.isActive, true)
          )
        )
        .limit(1);

      if (!existing) {
        logger.info(`Creating Global Fee Config: ${config.feeType}`);
        await database.insert(FeeConfigVersionModel).values(config);
      } else {
        await database
          .update(FeeConfigVersionModel)
          .set({
            feePayer: config.feePayer,
            deductionStrategy: config.deductionStrategy,
            rateOrAmount: config.rateOrAmount,
            taxRate: config.taxRate,
            taxTreatment: config.taxTreatment,
          })
          .where(eq(FeeConfigVersionModel.id, existing.id));
      }
    }

    logger.info('🌱 SCD2 Fee Configurations seeded successfully!');
  } catch (error) {
    logger.error('Error seeding Fee configurations:', error);
    throw error;
  }
}
