import type {
  PlatformFeeHistoryRow,
  PlatformFeeMethod,
  PlatformFeeNow,
  PlatformFeeQuote,
  PlatformFeeType,
  PlatformFeeValue,
} from '../types/platformFees.types';

/** Online booking fees Super Admin manages; owned by the payment module. */
export interface PlatformFeesPort {
  /** Highest value per fee and method; null means that method isn't allowed. */
  limits(): Record<PlatformFeeType, Record<PlatformFeeMethod, number | null>>;
  /** Fees in force for a clinic (its own or default), or the default when clinicId is null. */
  current(clinicId: string | null): Promise<PlatformFeeNow[]>;
  clinicsWithOwnFees(): Promise<string[]>;
  /** Throws a 422 when the value is outside the limits. */
  check(fee: PlatformFeeValue): void;
  save(
    fee: PlatformFeeValue & {
      clinicId: string | null;
      effectiveFrom?: Date;
      actorId: string;
    }
  ): Promise<{ id: string; effectiveFrom: Date }>;
  resetClinic(clinicId: string): Promise<number>;
  history(clinicId: string | null): Promise<PlatformFeeHistoryRow[]>;
  quote(price: number, fees: PlatformFeeValue[]): PlatformFeeQuote;
}
