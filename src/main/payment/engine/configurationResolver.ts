import { database } from '../../../configurations/dbConnection';
import { sql } from 'drizzle-orm';
import { IFeeConfig } from '../interfaces/splitEngine.types';

export class ConfigurationResolver {
  /**
   * Resolves active fee configurations in a single PostgreSQL query.
   * Prioritizes clinic-specific overrides over global fallbacks.
   * Throws an explicit error if active fee configurations are missing in DB (Fail-Fast pattern).
   */
  public static async getMergedConfigs(
    clinicId: string,
    timestamp: Date = new Date()
  ): Promise<IFeeConfig[]> {
    try {
      const effectiveTimestamp =
        timestamp instanceof Date ? timestamp.toISOString() : timestamp;

      const rawResults = await database.execute(sql`
        SELECT DISTINCT ON (fee_type)
          id,
          scope,
          clinic_id,
          version,
          fee_type,
          enabled,
          calculation_method,
          calculation_base,
          rate_or_amount,
          tax_rate,
          tax_treatment,
          fee_payer,
          fee_recipient,
          deduction_strategy,
          effective_from
        FROM fee_config_versions
        WHERE (clinic_id = ${clinicId} OR clinic_id IS NULL)
          AND is_active = true
          AND effective_from <= ${effectiveTimestamp}
          AND (effective_to IS NULL OR effective_to >= ${effectiveTimestamp})
        ORDER BY 
          fee_type, 
          (clinic_id IS NOT NULL) DESC, 
          version DESC;
      `);

      const rows: any[] = Array.isArray(rawResults)
        ? (rawResults as any[])
        : (rawResults as any)?.rows || [];

      if (!rows || rows.length === 0) {
        throw new Error(
          `Payment fee configuration not initialized in database for clinic ID: ${clinicId}. Please ensure fee_config_versions is seeded.`
        );
      }

      return rows.map((row) => ({
        feeName: row.fee_type.toLowerCase().replace(/_/g, ' '),
        feeType: row.fee_type,
        enabled: Boolean(row.enabled),
        calculationMethod: row.calculation_method,
        calculationBase: row.calculation_base,
        rateOrAmount: Number(row.rate_or_amount),
        taxRate: Number(row.tax_rate),
        taxTreatment: row.tax_treatment,
        feePayer: row.fee_payer,
        feeRecipient: row.fee_recipient,
        deductionStrategy: row.deduction_strategy,
        applicationLevel: 'APPOINTMENT_LEVEL',
        priority:
          row.fee_type === 'CONVENIENCE_FEE'
            ? 1
            : row.fee_type === 'CLINIC_COMMISSION'
              ? 2
              : 3,
        effectiveFrom: new Date(row.effective_from),
      }));
    } catch (error: any) {
      if (
        error.message?.includes('Payment fee configuration not initialized')
      ) {
        throw error;
      }
      throw new Error(
        `Failed to resolve payment fee configurations: ${error.message || String(error)}`
      );
    }
  }
}
