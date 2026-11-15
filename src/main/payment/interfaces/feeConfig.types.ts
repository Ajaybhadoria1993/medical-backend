import type { FEE_TYPES } from '../utils/feeConfig.utils';

export type FeeType = (typeof FEE_TYPES)[number];
export type FeeMethod = 'PERCENTAGE' | 'FIXED';

/** One fee value as Super Admin edits it. */
export interface FeeValue {
  feeType: FeeType;
  method: FeeMethod;
  amount: number;
  enabled: boolean;
}

/** A fee save for the default (clinicId null) or one clinic. */
export interface FeeSaveInput extends FeeValue {
  clinicId: string | null;
  /** When the new fee starts; now when missing. */
  effectiveFrom?: Date;
  actorId: string;
}
