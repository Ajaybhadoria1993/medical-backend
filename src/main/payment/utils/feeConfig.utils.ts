import type { FeeMethod, FeeType } from '../interfaces/feeConfig.types';

export const FEE_TYPES = [
  'CONVENIENCE_FEE',
  'CLINIC_COMMISSION',
  'GATEWAY_FEE',
] as const;

/** Safety limits on what a Super Admin can type; null means that method is not allowed. */
export const FEE_LIMITS: Record<FeeType, Record<FeeMethod, number | null>> = {
  CONVENIENCE_FEE: { PERCENTAGE: 10, FIXED: 200 },
  CLINIC_COMMISSION: { PERCENTAGE: 25, FIXED: 500 },
  GATEWAY_FEE: { PERCENTAGE: 5, FIXED: null },
};

/** Gateway is charged on the subtotal (price + other fees); the rest on the clinic's price. */
export const FEE_BASE: Record<FeeType, string> = {
  CONVENIENCE_FEE: 'CLINIC_SERVICE_PRICE',
  CLINIC_COMMISSION: 'CLINIC_SERVICE_PRICE',
  GATEWAY_FEE: 'PRE_GATEWAY_SUBTOTAL',
};

export const FEE_PRIORITY: Record<FeeType, number> = {
  CONVENIENCE_FEE: 1,
  CLINIC_COMMISSION: 2,
  GATEWAY_FEE: 3,
};
