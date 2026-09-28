export type CalculationMethod =
  'PERCENTAGE' | 'FIXED' | 'CLAMPED_PERCENTAGE' | 'TIERED';

export type CalculationBase =
  | 'CLINIC_SERVICE_PRICE' // Base service price P
  | 'PRE_GATEWAY_SUBTOTAL' // Subtotal before gateway fee
  | 'CLINIC_TRANSFER_AMOUNT' // Final P payable to clinic
  | 'TOTAL_TRANSACTION_AMOUNT' // Final total patient payable
  | 'CUSTOM_BASE';

export type FeePayer = 'PATIENT' | 'CLINIC' | 'PLATFORM';

export type FeeRecipient =
  'CLINIC' | 'PLATFORM' | 'PAYMENT_GATEWAY' | 'GOVERNMENT';

export type DeductionStrategy =
  | 'ADD_TO_PATIENT_TOTAL'
  | 'DEDUCT_FROM_CLINIC'
  | 'DEDUCT_FROM_PLATFORM'
  | 'ABSORBED_BY_PLATFORM'
  | 'ABSORBED_BY_CLINIC';

export type ApplicationLevel = 'APPOINTMENT_LEVEL' | 'TRANSACTION_LEVEL';

export type TaxTreatment = 'TAX_EXEMPT' | 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';

export interface IFeeConfig {
  feeName: string;
  feeType:
    | 'CONVENIENCE_FEE'
    | 'CLINIC_COMMISSION'
    | 'GATEWAY_FEE'
    | 'ROUTE_TRANSFER_FEE'
    | string;
  enabled: boolean;

  calculationMethod: CalculationMethod;
  calculationBase: CalculationBase;
  rateOrAmount: number; // e.g. 2 for 2%, or 50.00 for flat 50 INR
  minAmount?: number; // Clamp min (in Paise)
  maxAmount?: number; // Clamp max (in Paise)

  taxRate: number; // e.g. 18 for 18% GST
  taxTreatment: TaxTreatment; // Inclusive / Exclusive / Exempt

  feePayer: FeePayer;
  feeRecipient: FeeRecipient;
  deductionStrategy: DeductionStrategy;
  applicationLevel: ApplicationLevel;

  priority: number; // Calculation precedence ordering
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

export interface ISplitBreakdown {
  basePrice: number; // in Rupees
  gstOnPrice: number;
  convenienceFee: number;
  gstOnConvenienceFee: number;
  commission: number;
  gstOnCommission: number;
  gatewayFee: number;
  gstOnGatewayFee: number;
  routeTransferFee: number;
  gstOnRouteTransferFee: number;
}

export interface IPatientPricingSummary {
  consultationFee: number; // Base Doctor Consultation Price (Rupees)
  consultationGst: number; // GST on consultation if applicable (Rupees)
  platformFee: number; // Collective sum of all patient-borne fee components (Rupees)
  platformFeeGst: number; // Collective sum of all GST on patient-borne fee components (Rupees)
  gstRate: number; // Standard tax rate percentage (e.g. 18.0)
  totalPayable: number; // Final Rupees to be paid by patient
  currency: string; // 'INR'
}

export interface ISplitEngineResult {
  patientTotal: number; // Final Rupees charged to patient
  clinicAmount: number; // Net Rupees payable to clinic
  platformAmount: number; // Platform retained revenue
  gatewayAmount: number; // Estimated gateway processing cost
  taxAmount: number; // Total GST collected
  breakdown: ISplitBreakdown;
  patientPricingSummary: IPatientPricingSummary;
}
