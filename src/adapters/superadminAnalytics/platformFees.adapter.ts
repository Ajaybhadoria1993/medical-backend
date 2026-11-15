import type { PlatformFeesPort } from '../../main/superadminAnalytics';
import {
  FEE_LIMITS,
  FeeConfigVersionService as Fees,
} from '../../main/payment';

/** Super Admin's fee page backed by the payment module's versioned fee settings. */
export const platformFeesAdapter: PlatformFeesPort = {
  limits: () => FEE_LIMITS,
  current: (clinicId) => Fees.current(clinicId),
  clinicsWithOwnFees: () => Fees.clinicsWithOwnFees(),
  check: (fee) => Fees.check(fee.feeType, fee.method, fee.amount),
  save: async (fee) => {
    const row = await Fees.save(fee);
    return { id: row.id, effectiveFrom: row.effectiveFrom };
  },
  resetClinic: (clinicId) => Fees.resetClinic(clinicId),
  history: (clinicId) => Fees.history(clinicId),
  quote: (price, fees) => {
    const r = Fees.preview(price, fees);
    return { patientPays: r.patientTotal, clinicGets: r.clinicAmount };
  },
};
