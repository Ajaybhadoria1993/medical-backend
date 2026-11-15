import { fromPaise, toPaise } from './money.utils';

export interface PlanStepMoney {
  fee: string;
  selectedOption?: { extraFee: string } | null;
}

/** Price before discount: the step fees plus chosen option extras, or the package price. Paise. */
export function planBasePaise(
  pricingMode: 'per_step' | 'package',
  steps: PlanStepMoney[],
  packagePrice: string | null | undefined
): number {
  if (pricingMode === 'package') return toPaise(packagePrice ?? '0');
  return steps.reduce(
    (sum, s) =>
      sum + toPaise(s.fee) + toPaise(s.selectedOption?.extraFee ?? '0'),
    0
  );
}

export type SafetyKind = 'gap' | 'discount' | 'duplicate';

export interface SafetyIssue {
  kind: SafetyKind;
  message: string;
  /** Set on a gap issue: the step (1-based) whose gap is under the minimum. */
  seq?: number;
  minGapDays?: number;
}

export interface SafetyInput {
  steps: { name: string; gapDays: number }[];
  /** Minimum gap per step name from the template; a package uses its interval for every session after the first. */
  minGapByName?: Map<string, number>;
  packageInterval?: number | null;
  basePaise: number;
  discountPaise: number;
  capPercent: number;
  activePlanIds: string[];
}

/** Checks that need a reason before a plan is saved (DEV_PLAN step 2.4). Pure, so it is unit-tested. */
export function safetyIssues(input: SafetyInput): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  input.steps.forEach((step, i) => {
    const min =
      input.packageInterval != null
        ? i === 0
          ? 0
          : input.packageInterval
        : input.minGapByName?.get(step.name.trim().toLowerCase());
    if (min != null && step.gapDays < min)
      issues.push({
        kind: 'gap',
        seq: i + 1,
        minGapDays: min,
        message: `Step ${i + 1} (${step.name}) waits ${step.gapDays} days; the template's minimum is ${min}.`,
      });
  });

  if (input.discountPaise > 0 && input.basePaise > 0) {
    const percent = (input.discountPaise / input.basePaise) * 100;
    if (percent > input.capPercent)
      issues.push({
        kind: 'discount',
        message: `The discount is ${percent.toFixed(1)}% (₹${fromPaise(input.discountPaise)}); the clinic allows ${input.capPercent}% without approval.`,
      });
  }

  if (input.activePlanIds.length)
    issues.push({
      kind: 'duplicate',
      message: `This patient already has ${input.activePlanIds.length === 1 ? 'an open plan' : `${input.activePlanIds.length} open plans`} for the same treatment.`,
    });

  return issues;
}

/** Which suggested options a visit's prescription prints: every option while the proposal is open,
 *  only the decided one(s) once a group is accepted. Callers have already dropped declined and ended plans. */
export function printableOptions<
  T extends { proposalGroupId: string; status: string },
>(plans: T[]): T[] {
  const decided = new Set(
    plans.filter((p) => p.status !== 'proposed').map((p) => p.proposalGroupId)
  );
  return plans.filter(
    (p) => p.status !== 'proposed' || !decided.has(p.proposalGroupId)
  );
}
