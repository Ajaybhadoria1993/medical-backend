import { database } from '../../../configurations/dbConnection';
import { FeeConfigVersionModel } from '../models/feeConfigVersion.model';
import { and, eq, isNull, desc } from 'drizzle-orm';

export interface ICreateFeeConfigInput {
  scope: 'GLOBAL' | 'CLINIC';
  clinicId?: string;
  feeType: string;
  enabled: boolean;
  calculationMethod: string;
  calculationBase: string;
  rateOrAmount: string;
  taxRate?: string;
  taxTreatment?: string;
  feePayer?: string;
  feeRecipient?: string;
  deductionStrategy?: string;
}

export class FeeConfigVersionService {
  /**
   * Creates a new configuration version atomically using SCD Type 2 tracking.
   */
  public static async createNewVersion(input: ICreateFeeConfigInput) {
    const now = new Date();

    return await database.transaction(async (tx) => {
      // 1. Find currently active version for this scope & feeType
      const condition =
        input.scope === 'GLOBAL'
          ? and(
              eq(FeeConfigVersionModel.scope, 'GLOBAL'),
              eq(FeeConfigVersionModel.feeType, input.feeType),
              eq(FeeConfigVersionModel.isActive, true),
              isNull(FeeConfigVersionModel.effectiveTo)
            )
          : and(
              eq(FeeConfigVersionModel.scope, 'CLINIC'),
              eq(FeeConfigVersionModel.clinicId, input.clinicId!),
              eq(FeeConfigVersionModel.feeType, input.feeType),
              eq(FeeConfigVersionModel.isActive, true),
              isNull(FeeConfigVersionModel.effectiveTo)
            );

      const [activeRow] = await tx
        .select()
        .from(FeeConfigVersionModel)
        .where(condition)
        .limit(1);

      let nextVersion = 1;

      // 2. Terminate the old version (SCD Type 2 timestamp bound)
      if (activeRow) {
        nextVersion = activeRow.version + 1;
        await tx
          .update(FeeConfigVersionModel)
          .set({ isActive: false, effectiveTo: now })
          .where(eq(FeeConfigVersionModel.id, activeRow.id));
      }

      // 3. Insert the new active version
      const [newVersion] = await tx
        .insert(FeeConfigVersionModel)
        .values({
          scope: input.scope,
          clinicId: input.clinicId || null,
          version: nextVersion,
          feeType: input.feeType,
          enabled: input.enabled,
          calculationMethod: input.calculationMethod,
          calculationBase: input.calculationBase,
          rateOrAmount: input.rateOrAmount,
          taxRate: input.taxRate || '18.00',
          taxTreatment: input.taxTreatment || 'TAX_EXCLUSIVE',
          feePayer: input.feePayer || 'PATIENT',
          feeRecipient: input.feeRecipient || 'PLATFORM',
          deductionStrategy: input.deductionStrategy || 'ADD_TO_PATIENT_TOTAL',
          isActive: true,
          effectiveFrom: now,
          effectiveTo: null,
        })
        .returning();

      return newVersion;
    });
  }

  /**
   * Retrieves full version audit trail for Global or Clinic scope
   */
  public static async getAuditTrail(
    scope: 'GLOBAL' | 'CLINIC',
    clinicId?: string
  ) {
    if (scope === 'GLOBAL') {
      return await database
        .select()
        .from(FeeConfigVersionModel)
        .where(eq(FeeConfigVersionModel.scope, 'GLOBAL'))
        .orderBy(desc(FeeConfigVersionModel.version));
    }

    return await database
      .select()
      .from(FeeConfigVersionModel)
      .where(
        and(
          eq(FeeConfigVersionModel.scope, 'CLINIC'),
          eq(FeeConfigVersionModel.clinicId, clinicId!)
        )
      )
      .orderBy(desc(FeeConfigVersionModel.version));
  }
}
