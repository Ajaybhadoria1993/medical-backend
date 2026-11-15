/** Longest free trial Super Admin can give. */
export const MAX_TRIAL_DAYS = 365;

/** The clinic's own trial length wins over the trial plan's; 0 means no trial is offered. */
export function effectiveTrialDays(
  clinicDays: number | null | undefined,
  planDays: number | null | undefined
): number {
  return clinicDays ?? planDays ?? 0;
}
