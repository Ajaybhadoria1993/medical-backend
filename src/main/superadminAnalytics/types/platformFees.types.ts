export type PlatformFeeType =
  'CONVENIENCE_FEE' | 'CLINIC_COMMISSION' | 'GATEWAY_FEE';
export type PlatformFeeMethod = 'PERCENTAGE' | 'FIXED';

/** A fee value as Super Admin sets it. */
export interface PlatformFeeValue {
  feeType: PlatformFeeType;
  method: PlatformFeeMethod;
  amount: number;
  enabled: boolean;
}

/** One fee as a clinic pays it now, and any change already scheduled. */
export interface PlatformFeeNow extends PlatformFeeValue {
  source: 'default' | 'clinic';
  taxRate: number;
  effectiveFrom: Date | null;
  scheduled:
    (Omit<PlatformFeeValue, 'feeType'> & { effectiveFrom: Date }) | null;
}

export interface PlatformFeeHistoryRow {
  id: string;
  feeType: string;
  version: number;
  method: string;
  amount: string;
  enabled: boolean;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  createdByName: string | null;
}

/** Patient total and clinic share on a price, from the booking engine. */
export interface PlatformFeeQuote {
  patientPays: number;
  clinicGets: number;
}
