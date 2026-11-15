import { getPlatformFeesPort, getSourceDataPort } from '../ports';
import type { PlatformFeeValue } from '../types/platformFees.types';
import type {
  PlatformFeePreviewDto,
  PlatformFeeSaveDto,
} from '../schemas/platformFees.schema';

/** Super Admin's Platform Fees page: default fees, clinics' own fees, previews and history. */
export class PlatformFeesService {
  /** The page: fees in force (default or one clinic's), the limits, and clinics with their own fees. */
  static async overview(clinicId: string | null) {
    const fees = getPlatformFeesPort();
    const [now, ownIds] = await Promise.all([
      fees.current(clinicId),
      fees.clinicsWithOwnFees(),
    ]);
    const clinics = ownIds.length
      ? await getSourceDataPort().getClinicLabels(ownIds)
      : [];
    return { fees: now, limits: fees.limits(), clinicsWithOwnFees: clinics };
  }

  /** What a patient pays on the price today, and with the proposed change; the change is checked first. */
  static async preview({ clinicId, price, change }: PlatformFeePreviewDto) {
    const fees = getPlatformFeesPort();
    const now: PlatformFeeValue[] = (await fees.current(clinicId)).map(
      ({ feeType, method, amount, enabled }) => ({
        feeType,
        method,
        amount,
        enabled,
      })
    );
    if (change) fees.check(change);
    const next = change
      ? now.map((f) => (f.feeType === change.feeType ? change : f))
      : now;
    return {
      price,
      before: fees.quote(price, now),
      after: fees.quote(price, next),
    };
  }

  static save(body: PlatformFeeSaveDto, actorId: string) {
    return getPlatformFeesPort().save({ ...body, actorId });
  }

  static resetClinic(clinicId: string) {
    return getPlatformFeesPort().resetClinic(clinicId);
  }

  static history(clinicId: string | null) {
    return getPlatformFeesPort().history(clinicId);
  }
}
