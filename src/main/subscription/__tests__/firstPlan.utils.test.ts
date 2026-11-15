import { trialBlockReason } from '../utils/firstPlan.utils';

describe('trialBlockReason', () => {
  it('allows an owner on Free that never had a trial', () => {
    expect(trialBlockReason(true, false)).toBeNull();
  });

  it('refuses a second trial, even after going back to Free', () => {
    expect(trialBlockReason(true, true)).toBe('trial_used');
  });

  it('refuses while a trial is running', () => {
    expect(trialBlockReason(false, true)).toBe('trial_used');
  });

  it('refuses an owner on a paid plan', () => {
    expect(trialBlockReason(false, false)).toBe('paid_plan');
  });
});
