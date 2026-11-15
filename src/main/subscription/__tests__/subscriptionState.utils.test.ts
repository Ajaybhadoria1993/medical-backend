import { subscriptionState } from '../utils/subscriptionState.utils';

const ist = (s: string) => new Date(`${s}+05:30`);
const end = ist('2026-11-14T10:00:00');
const paid = {
  status: 'active' as const,
  isTrial: false,
  currentPeriodEnd: end,
  planKind: 'paid' as const,
};

describe('subscriptionState', () => {
  it('keeps a paid plan valid for the whole last day in IST', () => {
    const s = subscriptionState(paid, ist('2026-11-14T23:59:59.999'));
    expect(s).toMatchObject({ state: 'active', isValid: true });
    // Plus the 3 grace days for a paid plan that renews.
    expect(s.validUntil?.toISOString()).toBe(
      ist('2026-11-17T23:59:59.999').toISOString()
    );
  });

  it('keeps working as past_due in the grace days, then expires', () => {
    expect(subscriptionState(paid, ist('2026-11-15T00:00:00'))).toMatchObject({
      state: 'past_due',
      isValid: true,
    });
    expect(subscriptionState(paid, ist('2026-11-18T00:00:00'))).toMatchObject({
      state: 'expired',
      isValid: false,
    });
  });

  it('gives no grace to a plan cancelled at period end', () => {
    expect(
      subscriptionState(
        { ...paid, cancelAtPeriodEnd: true },
        ist('2026-11-15T00:00:00')
      )
    ).toMatchObject({ state: 'expired', isValid: false });
  });

  it('gives a trial the grace days to pay, then expires it', () => {
    const trial = { ...paid, status: 'trialing' as const, isTrial: true };
    expect(subscriptionState(trial, ist('2026-11-15T00:00:00'))).toMatchObject({
      state: 'past_due',
      isValid: true,
    });
    expect(subscriptionState(trial, ist('2026-11-18T00:00:00'))).toMatchObject({
      state: 'expired',
      isValid: false,
    });
  });

  it('never expires the Free plan', () => {
    expect(
      subscriptionState(
        { ...paid, currentPeriodEnd: null, planKind: 'free' },
        ist('2030-01-01T00:00:00')
      )
    ).toEqual({ state: 'free', isValid: true, validUntil: null });
  });

  it('reads a trial as trialing until its end', () => {
    expect(
      subscriptionState(
        { ...paid, status: 'trialing', isTrial: true },
        ist('2026-11-10T09:00:00')
      )
    ).toMatchObject({ state: 'trialing', isValid: true });
  });

  it('keeps past_due as its own state while the period is still running', () => {
    expect(
      subscriptionState(
        { ...paid, status: 'past_due' },
        ist('2026-11-10T09:00:00')
      )
    ).toMatchObject({ state: 'past_due', isValid: true });
  });

  it('treats a paid row with no end date as valid', () => {
    expect(subscriptionState({ ...paid, currentPeriodEnd: null })).toEqual({
      state: 'active',
      isValid: true,
      validUntil: null,
    });
  });

  it.each(['cancelled', 'expired', 'replaced'] as const)(
    'gives no access once the row is %s',
    (status) => {
      expect(
        subscriptionState({ ...paid, status }, ist('2026-11-10T09:00:00'))
      ).toMatchObject({ state: 'expired', isValid: false });
    }
  );
});
