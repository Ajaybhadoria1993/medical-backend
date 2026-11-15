import type {
  TreatmentPlan,
  TreatmentPlanStep,
} from '../models/treatmentPlan.model';
import type { PlanSnapshot } from '../types/plan.types';

/** The accepted plan as it stands now, for an immutable treatment_plan_versions row (DEV_PLAN 3.1, 3.3). */
export const snapshotOf = (
  plan: TreatmentPlan,
  steps: TreatmentPlanStep[]
): PlanSnapshot => ({
  steps: [...steps]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({
      seq: s.seq,
      name: s.name,
      gapDays: s.gapDays,
      durationMinutes: s.durationMinutes,
      fee: s.fee,
      selectedOption: s.selectedOption,
    })),
  totalAmount: plan.totalAmount,
  discountAmount: plan.discountAmount,
  advanceAmount: plan.advanceAmount,
  packageExpiresOn: plan.packageExpiresOn,
});
