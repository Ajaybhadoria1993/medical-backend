import {
  IFeeConfig,
  IPatientPricingSummary,
  ISplitEngineResult,
  TaxTreatment,
} from '../interfaces/splitEngine.types';

export class DynamicSplitEngine {
  /**
   * Runs the dynamic fee engine using integer math (paise) to prevent floating-point inaccuracies.
   * All inputs (servicePrice) are accepted in decimal Rupees and returned in Rupees.
   */
  public static calculate(
    servicePriceRupees: number,
    configs: IFeeConfig[],
    taxTreatmentP: TaxTreatment = 'TAX_EXEMPT',
    gstRateP: number = 18
  ): ISplitEngineResult {
    // 1. Convert base service price to integer Paise
    const P = Math.round(servicePriceRupees * 100);

    let baseClinicShare = P;
    let gstOnP = 0;
    if (taxTreatmentP === 'TAX_EXCLUSIVE') {
      gstOnP = Math.round(P * (gstRateP / 100));
    } else if (taxTreatmentP === 'TAX_INCLUSIVE') {
      gstOnP = Math.round(P - P / (1 + gstRateP / 100));
      baseClinicShare = P - gstOnP;
    }

    let F = 0; // Platform Convenience Fee
    let G1 = 0; // GST on Convenience Fee
    let CC = 0; // Clinic Platform Commission
    let G2 = 0; // GST on Commission
    let RG = 0; // Payment Gateway Fee
    let G3 = 0; // GST on Gateway Fee
    let RT = 0; // Route Transfer Fee
    let G4 = 0; // GST on Route Transfer Fee

    // Filter active configs and sort by execution priority
    const activeConfigs = configs
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority);

    const getBaseAmount = (
      baseType: string,
      currentSubtotal: number
    ): number => {
      switch (baseType) {
        case 'CLINIC_SERVICE_PRICE':
          return P;
        case 'PRE_GATEWAY_SUBTOTAL':
          return currentSubtotal;
        case 'CLINIC_TRANSFER_AMOUNT':
          return baseClinicShare;
        default:
          return P;
      }
    };

    const calculateFeeComponent = (
      config: IFeeConfig,
      base: number
    ): number => {
      let fee = 0;
      if (config.calculationMethod === 'PERCENTAGE') {
        fee = Math.round(base * (config.rateOrAmount / 100));
      } else if (config.calculationMethod === 'FIXED') {
        fee = Math.round(config.rateOrAmount * 100); // fixed amount in Rupees -> paise
      } else if (config.calculationMethod === 'CLAMPED_PERCENTAGE') {
        const calculated = Math.round(base * (config.rateOrAmount / 100));
        const min = config.minAmount !== undefined ? config.minAmount * 100 : 0;
        const max =
          config.maxAmount !== undefined ? config.maxAmount * 100 : Infinity;
        fee = Math.min(Math.max(calculated, min), max);
      }
      return fee;
    };

    // Step 2 & 3: Platform Convenience Fee (F) & GST (G1)
    const convConfig = activeConfigs.find(
      (c) => c.feeType === 'CONVENIENCE_FEE'
    );
    if (convConfig) {
      const base = getBaseAmount(convConfig.calculationBase, P);
      F = calculateFeeComponent(convConfig, base);
      if (convConfig.taxTreatment === 'TAX_EXCLUSIVE') {
        G1 = Math.round(F * (convConfig.taxRate / 100));
      }
    }

    // Step 4 & 5: Clinic Platform Commission (CC) & GST (G2)
    const commConfig = activeConfigs.find(
      (c) => c.feeType === 'CLINIC_COMMISSION'
    );
    if (commConfig) {
      const base = getBaseAmount(commConfig.calculationBase, P);
      CC = calculateFeeComponent(commConfig, base);
      if (commConfig.taxTreatment === 'TAX_EXCLUSIVE') {
        G2 = Math.round(CC * (commConfig.taxRate / 100));
      }
    }

    const subtotal = P + gstOnP + F + G1 + CC + G2;

    // Step 7 & 8: Payment Gateway Fee (RG) & GST (G3)
    const pgConfig = activeConfigs.find((c) => c.feeType === 'GATEWAY_FEE');
    if (pgConfig) {
      const base = getBaseAmount(pgConfig.calculationBase, subtotal);
      RG = calculateFeeComponent(pgConfig, base);
      if (pgConfig.taxTreatment === 'TAX_EXCLUSIVE') {
        G3 = Math.round(RG * (pgConfig.taxRate / 100));
      }
    }

    // Step 9 & 10: Route Transfer Fee (RT) & GST (G4)
    const routeConfig = activeConfigs.find(
      (c) => c.feeType === 'ROUTE_TRANSFER_FEE'
    );
    if (routeConfig) {
      const base = getBaseAmount(routeConfig.calculationBase, P);
      RT = calculateFeeComponent(routeConfig, base);
      if (routeConfig.taxTreatment === 'TAX_EXCLUSIVE') {
        G4 = Math.round(RT * (routeConfig.taxRate / 100));
      }
    }

    // Step 11: Calculate Final Patient Payable (TP)
    const TP = P + gstOnP + F + G1 + CC + G2 + RG + G3 + RT + G4;

    // Step 12: Calculate Party-wise Split Balances
    const clinicAmount = P;
    const platformAmount = F + CC;
    const gatewayAmount = RG + RT;
    const taxAmount = gstOnP + G1 + G2 + G3 + G4;

    // Step 13: Strict Reconciliation Audit Check (Micro-Reconciliation)
    const totalSplitSum =
      clinicAmount + platformAmount + gatewayAmount + taxAmount;
    if (TP !== totalSplitSum) {
      throw new Error(
        `Calculation Reconciliation Failure: Patient Payable (Paise: ${TP}) does not match cumulative split sums (Paise: ${totalSplitSum})`
      );
    }

    // Step 14: Calculate Collective Patient Platform Fee & Collective GST
    // Aggregates all components where fee_payer is PATIENT (or strategy is ADD_TO_PATIENT_TOTAL)
    let collectivePlatformFee = 0;
    let collectivePlatformGst = 0;

    if (
      convConfig &&
      (convConfig.feePayer === 'PATIENT' ||
        convConfig.deductionStrategy === 'ADD_TO_PATIENT_TOTAL')
    ) {
      collectivePlatformFee += F;
      collectivePlatformGst += G1;
    }
    if (
      commConfig &&
      (commConfig.feePayer === 'PATIENT' ||
        commConfig.deductionStrategy === 'ADD_TO_PATIENT_TOTAL')
    ) {
      collectivePlatformFee += CC;
      collectivePlatformGst += G2;
    }
    if (
      pgConfig &&
      (pgConfig.feePayer === 'PATIENT' ||
        pgConfig.deductionStrategy === 'ADD_TO_PATIENT_TOTAL')
    ) {
      collectivePlatformFee += RG;
      collectivePlatformGst += G3;
    }
    if (
      routeConfig &&
      (routeConfig.feePayer === 'PATIENT' ||
        routeConfig.deductionStrategy === 'ADD_TO_PATIENT_TOTAL')
    ) {
      collectivePlatformFee += RT;
      collectivePlatformGst += G4;
    }

    const patientPricingSummary: IPatientPricingSummary = {
      consultationFee: P / 100,
      consultationGst: gstOnP / 100,
      platformFee: collectivePlatformFee / 100,
      platformFeeGst: collectivePlatformGst / 100,
      gstRate: convConfig?.taxRate ?? 18,
      totalPayable: TP / 100,
      currency: 'INR',
    };

    return {
      patientTotal: TP / 100,
      clinicAmount: clinicAmount / 100,
      platformAmount: platformAmount / 100,
      gatewayAmount: gatewayAmount / 100,
      taxAmount: taxAmount / 100,
      breakdown: {
        basePrice: P / 100,
        gstOnPrice: gstOnP / 100,
        convenienceFee: F / 100,
        gstOnConvenienceFee: G1 / 100,
        commission: CC / 100,
        gstOnCommission: G2 / 100,
        gatewayFee: RG / 100,
        gstOnGatewayFee: G3 / 100,
        routeTransferFee: RT / 100,
        gstOnRouteTransferFee: G4 / 100,
      },
      patientPricingSummary,
    };
  }
}
