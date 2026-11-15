export type TrialBlock = 'trial_used' | 'paid_plan';

export const TRIAL_BLOCK_MESSAGES: Record<TrialBlock, string> = {
  trial_used: 'You have already used your free trial.',
  paid_plan: 'You already have a paid plan, so a free trial is not available.',
};

/** null when the trial is allowed. */
export const trialBlockReason = (
  onFree: boolean,
  hadTrial: boolean
): TrialBlock | null => (hadTrial ? 'trial_used' : onFree ? null : 'paid_plan');
