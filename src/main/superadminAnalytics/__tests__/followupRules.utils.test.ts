import { detectFollowups } from '../utils/followupRules.utils';
import type { ClinicFacts, SubscriptionSpan } from '../types/metrics.types';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const NOW = d('2026-09-29');

const facts = (over: Partial<ClinicFacts>): ClinicFacts => ({
  clinicId: 'c1',
  createdAt: d('2026-07-01'),
  acquisitionSource: 'Referral',
  onboardingCompleted: true,
  accountStatus: 'Active',
  deleted: false,
  firstValueAt: d('2026-07-05'),
  lastActivityAt: d('2026-09-28'),
  appointments30: 40,
  appointmentsPrev30: 40,
  activeDays30: 20,
  ...over,
});

const span = (over: Partial<SubscriptionSpan>): SubscriptionSpan => ({
  clinicId: 'c1',
  startsAt: d('2026-09-01'),
  expiresAt: null,
  monthlyValue: 999,
  isTrial: false,
  isPaid: true,
  planName: 'CareHub',
  ...over,
});

const types = (f: ClinicFacts[], s: SubscriptionSpan[] = []) =>
  detectFollowups(f, s, NOW).map(
    (x) => `${x.clinicId}:${x.type}:${x.priority}`
  );

describe('detectFollowups', () => {
  it('flags nothing for a healthy clinic', () => {
    expect(types([facts({})])).toEqual([]);
  });

  it('flags setup stuck after 3 days, not before', () => {
    const base = {
      onboardingCompleted: false,
      firstValueAt: null,
      lastActivityAt: null,
    };
    expect(types([facts({ ...base, createdAt: d('2026-09-26') })])).toEqual([
      'c1:setup_stuck:medium',
    ]);
    expect(types([facts({ ...base, createdAt: d('2026-09-28') })])).toEqual([]);
  });

  it('flags no first value after 7 days', () => {
    expect(
      types([
        facts({
          firstValueAt: null,
          lastActivityAt: null,
          createdAt: d('2026-09-20'),
        }),
      ])
    ).toEqual(['c1:no_first_value:medium']);
    expect(
      types([
        facts({
          firstValueAt: null,
          lastActivityAt: null,
          createdAt: d('2026-09-20'),
          accountStatus: 'Pending',
        }),
      ])
    ).toEqual([]);
  });

  it('raises priority for paying clinics that go quiet', () => {
    const quiet = facts({
      lastActivityAt: d('2026-09-10'),
      appointments30: 2,
      activeDays30: 1,
    });
    expect(types([quiet])).toEqual(['c1:dormant:medium']);
    expect(types([quiet], [span({})])).toEqual(['c1:dormant:high']);
  });

  it('flags a usage drop of 50% or more', () => {
    expect(
      types([facts({ appointments30: 20, appointmentsPrev30: 40 })])
    ).toEqual(['c1:usage_drop:medium']);
  });

  it('flags churn risk after 60 idle days', () => {
    expect(
      types([facts({ lastActivityAt: d('2026-07-20'), appointments30: 0 })])
    ).toEqual(['c1:churn_risk:low']);
  });

  it('flags a trial ending within 3 days only while unpaid', () => {
    const trial = span({
      isTrial: true,
      monthlyValue: 0,
      expiresAt: d('2026-10-01'),
    });
    expect(types([facts({})], [trial])).toEqual(['c1:trial_ending:high']);
    expect(types([facts({})], [trial, span({})])).toEqual([]);
    expect(
      types([facts({})], [{ ...trial, expiresAt: d('2026-10-10') }])
    ).toEqual([]);
  });

  it('prints whole days in the reason', () => {
    const late = facts({
      firstValueAt: null,
      lastActivityAt: null,
      createdAt: new Date('2026-09-20T15:30:00.000Z'),
    });
    expect(detectFollowups([late], [], NOW)[0].reason).toBe(
      'Set up but no completed appointment after 8 days'
    );
  });

  it('ignores deleted, rejected and blocked clinics', () => {
    const quiet = { lastActivityAt: d('2026-09-10'), appointments30: 0 };
    expect(
      types([
        facts({ ...quiet, clinicId: 'a', deleted: true }),
        facts({ ...quiet, clinicId: 'b', accountStatus: 'Rejected' }),
        facts({ ...quiet, clinicId: 'c', accountStatus: 'Blocked' }),
      ])
    ).toEqual([]);
  });

  describe('payout_blocked', () => {
    const blocked = (over: Partial<ClinicFacts>) =>
      detectFollowups([facts(over)], [span({})], NOW).find(
        (t) => t.type === 'payout_blocked'
      );

    it('opens High, says who must act, and keeps the details for the drawer', () => {
      const task = blocked({
        payoutStatus: 'NEEDS_CLARIFICATION',
        payoutReason: 'bank IFSC code: invalid',
        payoutChangedAt: d('2026-09-26'),
        payoutAccountId: 'acc_1',
      });
      expect(task).toMatchObject({
        priority: 'high',
        reason:
          "Razorpay couldn't verify the bank or UPI details; the clinic must enter different ones (3 days)",
        triggerData: {
          cause: 'bank_details',
          razorpayReason: 'bank IFSC code: invalid',
          daysWaiting: 3,
          razorpayAccountId: 'acc_1',
        },
      });
    });

    it('names the cause, so the team knows whether Razorpay or the clinic acts', () => {
      const cause = (payoutStatus: string, payoutReason: string | null) =>
        blocked({ payoutStatus, payoutReason })?.triggerData.cause;
      expect(
        cause(
          'NEEDS_CLARIFICATION',
          'Razorpay has stopped checking new bank details for this account.'
        )
      ).toBe('bank_locked');
      expect(cause('NEEDS_CLARIFICATION', 'stakeholder PAN: invalid')).toBe(
        'documents'
      );
      expect(cause('SUSPENDED', null)).toBe('suspended');
      expect(cause('REJECTED', null)).toBe('rejected');
      expect(cause('NEEDS_CLARIFICATION', null)).toBe('other');
    });

    it('stays quiet when payouts are ready, verifying, being set up or never started', () => {
      for (const payoutStatus of ['ACTIVE', 'PENDING', 'DRAFT', null])
        expect(blocked({ payoutStatus })).toBeUndefined();
    });
  });
});
