import { freeTrialDaysSchema } from '../schemas/freeTrial.schemas';
import {
  MAX_TRIAL_DAYS,
  effectiveTrialDays,
} from '../utils/trialDays.utils';

describe('effectiveTrialDays', () => {
  it("prefers the clinic's own length", () => {
    expect(effectiveTrialDays(90, 30)).toBe(90);
  });

  it("falls back to the trial plan's days when the clinic has none", () => {
    expect(effectiveTrialDays(null, 30)).toBe(30);
    expect(effectiveTrialDays(undefined, 30)).toBe(30);
  });

  it('is 0 when neither is set, so no trial is offered', () => {
    expect(effectiveTrialDays(null, null)).toBe(0);
    expect(effectiveTrialDays(undefined, undefined)).toBe(0);
  });
});

describe('freeTrialDaysSchema', () => {
  const reason = 'Onboarding offer';

  it('accepts 1 to the maximum number of days', () => {
    expect(freeTrialDaysSchema.safeParse({ days: 1, reason }).success).toBe(true);
    expect(
      freeTrialDaysSchema.safeParse({ days: MAX_TRIAL_DAYS, reason }).success
    ).toBe(true);
  });

  it('rejects 0, too many, and fractional days', () => {
    for (const days of [0, MAX_TRIAL_DAYS + 1, 2.5, -3]) {
      expect(freeTrialDaysSchema.safeParse({ days, reason }).success).toBe(false);
    }
  });

  it('needs a reason', () => {
    expect(freeTrialDaysSchema.safeParse({ days: 30, reason: 'no' }).success).toBe(
      false
    );
    expect(freeTrialDaysSchema.safeParse({ days: 30 }).success).toBe(false);
  });
});
