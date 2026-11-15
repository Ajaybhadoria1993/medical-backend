import {
  billingCycleFromProviderId,
  CYCLE_DAYS,
  isYearlyProviderId,
  planPriceForCycle,
  providerIdForCycle,
  unusedSubscriptionValue,
  yearlySavings,
} from '../utils/billingCycle.utils';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('planPriceForCycle and yearlySavings', () => {
  it('derives the yearly price from the monthly price', () => {
    expect(planPriceForCycle(2000, 'monthly')).toBe(2000);
    expect(planPriceForCycle(2000, 'yearly')).toBe(19200);
    expect(planPriceForCycle('499', 'yearly')).toBe(4790);
  });

  it('reports the yearly saving only for yearly', () => {
    expect(yearlySavings(2000, 'yearly')).toBe(4800);
    expect(yearlySavings(2000, 'monthly')).toBe(0);
  });
});

describe('cycle read from provider_subscription_id', () => {
  // Old rows get their billing cycle from these rules, so every known value is pinned.
  it.each([
    ['carehub-yearly', true],
    ['pro-yearly', true],
    ['basic-yearly', true],
    ['clinic_yearly', true],
    ['yearly', true],
    ['carehub-monthly', false],
    ['free_plan', false],
    ['default-free', false],
    ['manual', false],
    [null, false],
    [undefined, false],
  ])('%s → yearly: %s', (providerId, yearly) => {
    expect(isYearlyProviderId(providerId)).toBe(yearly);
    expect(billingCycleFromProviderId(providerId)).toBe(
      yearly ? 'yearly' : 'monthly'
    );
  });

  it('builds the provider id from the plan slug, falling back to carehub', () => {
    expect(providerIdForCycle('yearly')).toBe('carehub-yearly');
    expect(providerIdForCycle('monthly', 'clinic-monthly')).toBe(
      'clinic-monthly'
    );
    expect(providerIdForCycle('yearly', 'clinic-monthly')).toBe(
      'clinic-yearly'
    );
    expect(providerIdForCycle('yearly', 'solo')).toBe('carehub-yearly');
  });
});

describe('CYCLE_DAYS', () => {
  it('is 30 days monthly and 365 days yearly', () => {
    expect(CYCLE_DAYS).toEqual({ monthly: 30, yearly: 365 });
  });
});

describe('unusedSubscriptionValue (credit on an upgrade)', () => {
  const paid = {
    pricePaid: 3000,
    startsAt: day('2026-11-01'),
    expiresAt: day('2026-12-01'),
  };

  it('credits the unused days at the daily rate paid', () => {
    expect(
      unusedSubscriptionValue({ ...paid, now: day('2026-11-16') })
    ).toEqual({
      credit: 1500,
      remainingDays: 15,
      totalDays: 30,
    });
  });

  it('rounds the credit to a whole rupee', () => {
    const result = unusedSubscriptionValue({
      pricePaid: 999,
      startsAt: day('2026-11-01'),
      expiresAt: day('2026-12-01'),
      now: day('2026-11-21'),
    });
    expect(result).toEqual({ credit: 333, remainingDays: 10, totalDays: 30 });
  });

  it('never credits more than was paid, even with a start date in the future', () => {
    const result = unusedSubscriptionValue({ ...paid, now: day('2026-10-20') });
    expect(result.credit).toBe(3000);
    expect(result.remainingDays).toBe(30);
  });

  it('credits nothing once the period is over', () => {
    expect(
      unusedSubscriptionValue({ ...paid, now: day('2026-12-02') }).credit
    ).toBe(0);
  });

  it.each([
    ['a free plan', { ...paid, pricePaid: 0 }],
    ['no end date', { ...paid, expiresAt: null }],
    ['no start date', { ...paid, startsAt: null }],
    ['a bad date', { ...paid, expiresAt: 'not a date' }],
  ])('credits nothing for %s', (_label, input) => {
    expect(
      unusedSubscriptionValue({ ...input, now: day('2026-11-16') }).credit
    ).toBe(0);
  });
});
