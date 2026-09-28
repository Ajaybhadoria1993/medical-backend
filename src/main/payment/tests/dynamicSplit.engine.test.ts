import { DynamicSplitEngine } from '../engine/dynamicSplit.engine';
import { IFeeConfig } from '../interfaces/splitEngine.types';

describe('DynamicSplitEngine Unit Tests', () => {
  const baseConfigs: IFeeConfig[] = [
    {
      feeName: 'Convenience Fee',
      feeType: 'CONVENIENCE_FEE',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'CLINIC_SERVICE_PRICE',
      rateOrAmount: 2, // 2%
      taxRate: 18,
      taxTreatment: 'TAX_EXCLUSIVE',
      feePayer: 'PATIENT',
      feeRecipient: 'PLATFORM',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      applicationLevel: 'APPOINTMENT_LEVEL',
      priority: 1,
      effectiveFrom: new Date('2020-01-01'),
      effectiveTo: null,
    },
    {
      feeName: 'Platform Commission',
      feeType: 'CLINIC_COMMISSION',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'CLINIC_SERVICE_PRICE',
      rateOrAmount: 5, // 5%
      taxRate: 18,
      taxTreatment: 'TAX_EXCLUSIVE',
      feePayer: 'PATIENT',
      feeRecipient: 'PLATFORM',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      applicationLevel: 'APPOINTMENT_LEVEL',
      priority: 2,
      effectiveFrom: new Date('2020-01-01'),
      effectiveTo: null,
    },
    {
      feeName: 'Gateway Fee',
      feeType: 'GATEWAY_FEE',
      enabled: true,
      calculationMethod: 'PERCENTAGE',
      calculationBase: 'PRE_GATEWAY_SUBTOTAL',
      rateOrAmount: 2, // 2%
      taxRate: 18,
      taxTreatment: 'TAX_EXCLUSIVE',
      feePayer: 'PATIENT',
      feeRecipient: 'PAYMENT_GATEWAY',
      deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
      applicationLevel: 'APPOINTMENT_LEVEL',
      priority: 3,
      effectiveFrom: new Date('2020-01-01'),
      effectiveTo: null,
    },
  ];

  it('should calculate dynamic split correctly for 500 INR service price', () => {
    const result = DynamicSplitEngine.calculate(500, baseConfigs);

    expect(result.patientTotal).toBeGreaterThan(500);
    expect(result.clinicAmount).toBe(500);
    expect(result.platformAmount).toBeGreaterThan(0);
    expect(result.gatewayAmount).toBeGreaterThan(0);
    expect(result.taxAmount).toBeGreaterThan(0);

    // Micro-reconciliation invariant: Patient Total must strictly match the sum of all party balances
    const sum =
      result.clinicAmount +
      result.platformAmount +
      result.gatewayAmount +
      result.taxAmount;

    expect(Number(result.patientTotal.toFixed(2))).toBe(Number(sum.toFixed(2)));

    // Verify patientPricingSummary
    expect(result.patientPricingSummary).toBeDefined();
    expect(result.patientPricingSummary.consultationFee).toBe(500);
    expect(result.patientPricingSummary.totalPayable).toBe(result.patientTotal);
    expect(result.patientPricingSummary.platformFee).toBeGreaterThan(0);
    expect(result.patientPricingSummary.platformFeeGst).toBeGreaterThan(0);

    const pricingSum =
      result.patientPricingSummary.consultationFee +
      result.patientPricingSummary.consultationGst +
      result.patientPricingSummary.platformFee +
      result.patientPricingSummary.platformFeeGst;
    expect(Number(pricingSum.toFixed(2))).toBe(
      Number(result.patientPricingSummary.totalPayable.toFixed(2))
    );
  });

  it('should collectively aggregate all patient-borne fee components and their GST', () => {
    // 500 INR Consultation
    // Convenience Fee: 2% = 10 INR, GST 18% = 1.80 INR (PATIENT)
    // Clinic Commission: 5% = 25 INR, GST 18% = 4.50 INR (PATIENT)
    // Gateway Fee: 2% on (500+10+1.8+25+4.5 = 541.3) = 10.826 ~ 10.83 INR, GST 18% = 1.95 INR (PATIENT)
    const result = DynamicSplitEngine.calculate(500, baseConfigs);

    const expectedPlatformFee =
      result.breakdown.convenienceFee +
      result.breakdown.commission +
      result.breakdown.gatewayFee;

    const expectedGst =
      result.breakdown.gstOnConvenienceFee +
      result.breakdown.gstOnCommission +
      result.breakdown.gstOnGatewayFee;

    expect(result.patientPricingSummary.platformFee).toBeCloseTo(
      expectedPlatformFee,
      2
    );
    expect(result.patientPricingSummary.platformFeeGst).toBeCloseTo(
      expectedGst,
      2
    );
    expect(result.patientPricingSummary.totalPayable).toBe(result.patientTotal);
  });

  it('should handle FIXED calculation method correctly', () => {
    const fixedConfigs: IFeeConfig[] = [
      {
        feeName: 'Flat Platform Fee',
        feeType: 'CONVENIENCE_FEE',
        enabled: true,
        calculationMethod: 'FIXED',
        calculationBase: 'CLINIC_SERVICE_PRICE',
        rateOrAmount: 25.0, // flat 25 INR
        taxRate: 18,
        taxTreatment: 'TAX_EXCLUSIVE',
        feePayer: 'PATIENT',
        feeRecipient: 'PLATFORM',
        deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
        applicationLevel: 'APPOINTMENT_LEVEL',
        priority: 1,
        effectiveFrom: new Date('2020-01-01'),
        effectiveTo: null,
      },
    ];

    const result = DynamicSplitEngine.calculate(1000, fixedConfigs);

    expect(result.breakdown.convenienceFee).toBe(25.0);
    expect(result.breakdown.gstOnConvenienceFee).toBe(4.5); // 18% of 25 = 4.50
    expect(result.patientTotal).toBe(1029.5); // 1000 + 25 + 4.5
    expect(result.clinicAmount).toBe(1000);
    expect(result.patientPricingSummary.consultationFee).toBe(1000);
    expect(result.patientPricingSummary.platformFee).toBe(25.0);
    expect(result.patientPricingSummary.platformFeeGst).toBe(4.5);
    expect(result.patientPricingSummary.totalPayable).toBe(1029.5);
  });

  it('should handle CLAMPED_PERCENTAGE calculation method', () => {
    const clampedConfigs: IFeeConfig[] = [
      {
        feeName: 'Clamped Fee',
        feeType: 'CONVENIENCE_FEE',
        enabled: true,
        calculationMethod: 'CLAMPED_PERCENTAGE',
        calculationBase: 'CLINIC_SERVICE_PRICE',
        rateOrAmount: 10, // 10%
        minAmount: 10, // min 10 INR
        maxAmount: 30, // max 30 INR
        taxRate: 0,
        taxTreatment: 'TAX_EXEMPT',
        feePayer: 'PATIENT',
        feeRecipient: 'PLATFORM',
        deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
        applicationLevel: 'APPOINTMENT_LEVEL',
        priority: 1,
        effectiveFrom: new Date('2020-01-01'),
        effectiveTo: null,
      },
    ];

    // For 1000 INR, 10% is 100, clamped to max 30
    const resultHigh = DynamicSplitEngine.calculate(1000, clampedConfigs);
    expect(resultHigh.breakdown.convenienceFee).toBe(30);
    expect(resultHigh.patientPricingSummary.platformFee).toBe(30);

    // For 50 INR, 10% is 5, clamped to min 10
    const resultLow = DynamicSplitEngine.calculate(50, clampedConfigs);
    expect(resultLow.breakdown.convenienceFee).toBe(10);
    expect(resultLow.patientPricingSummary.platformFee).toBe(10);
  });
});
