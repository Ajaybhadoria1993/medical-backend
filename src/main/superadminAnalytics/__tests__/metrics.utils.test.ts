import {
  billingAt,
  clinicStage,
  cohortFunnel,
  freeToPaid,
  movementCounts,
  mrrBridge,
  mrrByClinicAt,
  planMix,
  sourcePerformance,
  timeToFirstValue,
  trialToPaid,
  liveTrials,
  plansInUse,
  yearTrend,
} from '../utils/metrics.utils';
import { fillDays, resolvePeriod } from '../utils/period.utils';
import type { ClinicFacts, SubscriptionSpan } from '../types/metrics.types';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const span = (over: Partial<SubscriptionSpan>): SubscriptionSpan => ({
  clinicId: 'c1',
  startsAt: d('2026-01-01'),
  expiresAt: null,
  monthlyValue: 499,
  isTrial: false,
  isPaid: true,
  planName: 'Basic',
  ...over,
});

const facts = (over: Partial<ClinicFacts>): ClinicFacts => ({
  clinicId: 'c1',
  createdAt: d('2026-07-01'),
  acquisitionSource: 'Referral',
  onboardingCompleted: true,
  accountStatus: 'Active',
  deleted: false,
  firstValueAt: d('2026-08-01'),
  lastActivityAt: d('2026-09-28'),
  appointments30: 40,
  appointmentsPrev30: 40,
  activeDays30: 20,
  ...over,
});

describe('billingAt plan label', () => {
  it('shows a 100%-off coupon plan as Paid and skips unpaid and free rows', () => {
    const spans = [
      span({ planName: 'Free', monthlyValue: 0, isFreePlan: true }),
      span({ planName: 'Pro', isPaid: false }),
      span({ planName: 'Care Hub', monthlyValue: 0 }),
    ];
    expect(billingAt(spans, 'c1', d('2026-06-01'))).toEqual({
      billing: 'Paid',
      planName: 'Care Hub',
    });
    expect(billingAt(spans.slice(0, 2), 'c1', d('2026-06-01'))).toEqual({
      billing: 'Free',
      planName: 'Free',
    });
  });
});

describe('mrrByClinicAt', () => {
  it('ignores trials, free plans, unpaid rows and spans not covering the instant', () => {
    const spans = [
      span({ clinicId: 'paid' }),
      span({ clinicId: 'trial', isTrial: true }),
      span({ clinicId: 'free', monthlyValue: 0 }),
      span({ clinicId: 'unpaid', isPaid: false }),
      span({ clinicId: 'expired', expiresAt: d('2026-03-01') }),
    ];
    expect([...mrrByClinicAt(spans, d('2026-06-01'))]).toEqual([['paid', 499]]);
  });
});

describe('mrrBridge over a long range', () => {
  it('counts a clinic that joined and left inside the range as new and lost', () => {
    const spans = [
      span({
        clinicId: 'x',
        startsAt: d('2026-08-01'),
        expiresAt: d('2026-09-15'),
        monthlyValue: 999,
      }),
    ];
    const b = mrrBridge(spans, d('2026-04-01'), d('2026-09-30'));
    expect(b).toEqual({
      opening: 0,
      newMrr: 999,
      expansion: 0,
      contraction: 0,
      churned: 999,
      closing: 0,
    });
    expect(movementCounts(spans, d('2026-04-01'), d('2026-09-30'))).toEqual({
      newPaid: 1,
      upgrades: 0,
      downgrades: 0,
      churned: 1,
    });
  });
});

describe('mrrBridge', () => {
  const start = d('2026-09-01');
  const end = d('2026-09-30');
  const spans = [
    span({ clinicId: 'kept' }),
    span({ clinicId: 'new', startsAt: d('2026-09-10') }),
    span({ clinicId: 'up', expiresAt: d('2026-09-15') }),
    span({ clinicId: 'up', startsAt: d('2026-09-15'), monthlyValue: 999 }),
    span({ clinicId: 'down', monthlyValue: 999, expiresAt: d('2026-09-15') }),
    span({ clinicId: 'down', startsAt: d('2026-09-15') }),
    span({ clinicId: 'gone', expiresAt: d('2026-09-20') }),
  ];

  it('classifies each clinic and closes to the rupee', () => {
    const b = mrrBridge(spans, start, end);
    expect(b).toEqual({
      opening: 499 + 499 + 999 + 499,
      newMrr: 499,
      expansion: 500,
      contraction: 500,
      churned: 499,
      closing: 499 + 499 + 999 + 499,
    });
    expect(b.opening + b.newMrr + b.expansion - b.contraction - b.churned).toBe(
      b.closing
    );
  });

  it('counts one clinic per move, matching the bridge', () => {
    expect(movementCounts(spans, start, end)).toEqual({
      newPaid: 1,
      upgrades: 1,
      downgrades: 1,
      churned: 1,
    });
  });
});

describe('planMix', () => {
  it('groups paying clinics by plan with MRR share, biggest first', () => {
    const s = [
      span({ clinicId: 'a', planName: 'Basic' }),
      span({ clinicId: 'b', planName: 'Basic' }),
      span({ clinicId: 'c', planName: 'Pro', monthlyValue: 998 }),
      span({
        clinicId: 't',
        planName: 'Pro Trial',
        isTrial: true,
        monthlyValue: 0,
      }),
    ];
    expect(planMix(s, d('2026-09-15'))).toEqual([
      { planName: 'Basic', clinics: 2, mrr: 998, share: 50 },
      { planName: 'Pro', clinics: 1, mrr: 998, share: 50 },
    ]);
  });
});

describe('timeToFirstValue', () => {
  it('buckets the period cohort and reports the median in days', () => {
    const at = (ymd: string, h = 0) =>
      new Date(`${ymd}T${String(h).padStart(2, '0')}:00:00.000Z`);
    const f = [
      facts({
        clinicId: 'a',
        createdAt: at('2026-09-01'),
        firstValueAt: at('2026-09-01', 6),
      }),
      facts({
        clinicId: 'b',
        createdAt: at('2026-09-01'),
        firstValueAt: at('2026-09-03'),
      }),
      facts({
        clinicId: 'c',
        createdAt: at('2026-09-01'),
        firstValueAt: at('2026-09-11'),
      }),
      facts({ clinicId: 'd', createdAt: at('2026-09-02'), firstValueAt: null }),
      facts({
        clinicId: 'old',
        createdAt: at('2026-07-01'),
        firstValueAt: at('2026-07-02'),
      }),
    ];
    expect(timeToFirstValue(f, d('2026-09-01'), d('2026-09-30'))).toEqual({
      medianDays: 2,
      underOneDay: 1,
      oneToThree: 1,
      threeToSeven: 0,
      overSeven: 1,
      notYet: 1,
    });
  });
});

describe('sourcePerformance', () => {
  it('splits the cohort by source with paid clinics and their MRR now', () => {
    const f = [
      facts({
        clinicId: 'r1',
        createdAt: d('2026-09-02'),
        acquisitionSource: 'Referral',
      }),
      facts({
        clinicId: 'r2',
        createdAt: d('2026-09-03'),
        acquisitionSource: 'Referral',
        firstValueAt: null,
      }),
      facts({
        clinicId: 'w1',
        createdAt: d('2026-09-04'),
        acquisitionSource: 'Website',
      }),
    ];
    const s = [span({ clinicId: 'r1', startsAt: d('2026-09-10') })];
    expect(
      sourcePerformance(f, s, d('2026-09-01'), d('2026-09-30'), d('2026-09-29'))
    ).toEqual([
      { source: 'Referral', registered: 2, firstValue: 1, paid: 1, mrr: 499 },
      { source: 'Website', registered: 1, firstValue: 1, paid: 0, mrr: 0 },
    ]);
  });
});

describe('clinicStage', () => {
  const now = d('2026-09-29');
  it.each<[string, Partial<ClinicFacts>, string]>([
    ['deleted', { deleted: true }, 'Churned'],
    [
      'no setup',
      { firstValueAt: null, onboardingCompleted: false },
      'Registered',
    ],
    ['setup, no consult', { firstValueAt: null }, 'SetupDone'],
    ['idle 14 days', { lastActivityAt: d('2026-09-15') }, 'Dormant'],
    ['idle 60 days', { lastActivityAt: d('2026-07-31') }, 'Churned'],
    ['too few days', { activeDays30: 3 }, 'FirstValue'],
    ['usage halved', { appointmentsPrev30: 80 }, 'Declining'],
    ['steady', {}, 'Active'],
  ])('%s → %s', (_label, over, stage) => {
    expect(clinicStage(facts(over), now)).toBe(stage);
  });
});

describe('conversions', () => {
  const start = d('2026-09-01');
  const end = d('2026-09-30');

  it('Free → Paid counts only clinics reaching First Value in the period', () => {
    const f = [
      facts({ clinicId: 'a', firstValueAt: d('2026-09-05') }),
      facts({ clinicId: 'b', firstValueAt: d('2026-09-06') }),
      facts({ clinicId: 'old', firstValueAt: d('2026-05-01') }),
    ];
    const s = [
      span({ clinicId: 'a', startsAt: d('2026-09-20') }),
      span({ clinicId: 'old' }),
    ];
    expect(freeToPaid(f, s, start, end)).toEqual({
      converted: 1,
      eligible: 2,
      rate: 50,
    });
  });

  it('Trial → Paid needs a paid plan after the trial began', () => {
    const s = [
      span({
        clinicId: 't1',
        isTrial: true,
        startsAt: d('2026-09-02'),
        monthlyValue: 0,
      }),
      span({ clinicId: 't1', startsAt: d('2026-09-16') }),
      span({
        clinicId: 't2',
        isTrial: true,
        startsAt: d('2026-09-03'),
        monthlyValue: 0,
      }),
      span({
        clinicId: 't3',
        isTrial: true,
        startsAt: d('2026-08-01'),
        monthlyValue: 0,
      }),
    ];
    expect(trialToPaid(s, start, end)).toEqual({
      converted: 1,
      eligible: 2,
      rate: 50,
    });
  });

  it('returns 0% with nobody eligible instead of dividing by zero', () => {
    expect(trialToPaid([], start, end)).toEqual({
      converted: 0,
      eligible: 0,
      rate: 0,
    });
  });
});

describe('cohortFunnel', () => {
  it('keeps every step a subset of the one before', () => {
    const now = d('2026-09-29');
    const f = [
      facts({ clinicId: 'paid', createdAt: d('2026-09-02') }),
      facts({ clinicId: 'active', createdAt: d('2026-09-03') }),
      facts({ clinicId: 'fv', createdAt: d('2026-09-04'), activeDays30: 1 }),
      facts({
        clinicId: 'setup',
        createdAt: d('2026-09-05'),
        firstValueAt: null,
      }),
      facts({
        clinicId: 'reg',
        createdAt: d('2026-09-06'),
        firstValueAt: null,
        onboardingCompleted: false,
      }),
      facts({ clinicId: 'before', createdAt: d('2026-08-01') }),
    ];
    const s = [span({ clinicId: 'paid', startsAt: d('2026-09-10') })];
    expect(cohortFunnel(f, s, d('2026-09-01'), d('2026-09-30'), now)).toEqual({
      registered: 5,
      setupDone: 4,
      firstValue: 3,
      active: 2,
      paid: 1,
    });
  });
});

describe('billingAt', () => {
  const at = d('2026-09-15');
  it('prefers a paid plan over a trial', () => {
    const s = [
      span({ isTrial: true, monthlyValue: 0, planName: 'Pro Trial' }),
      span({ planName: 'Pro' }),
    ];
    expect(billingAt(s, 'c1', at)).toEqual({
      billing: 'Paid',
      planName: 'Pro',
    });
  });
  it('is Free when nothing paid covers the date', () => {
    expect(
      billingAt([span({ expiresAt: d('2026-09-01') })], 'c1', at).billing
    ).toBe('Free');
  });
});

describe('yearTrend', () => {
  it('reports each month of the year up to now, with counts', () => {
    const s = [span({ startsAt: d('2026-02-10') })];
    const f = [
      facts({ createdAt: d('2026-02-03') }),
      facts({ clinicId: 'c2', createdAt: d('2026-03-15') }),
    ];
    const trend = yearTrend(s, f, new Map([['2026-03', 12]]), d('2026-03-20'));
    expect(trend).toEqual([
      {
        month: '2026-01',
        mrr: 0,
        paidClinics: 0,
        registrations: 0,
        appointments: 0,
      },
      {
        month: '2026-02',
        mrr: 499,
        paidClinics: 1,
        registrations: 1,
        appointments: 0,
      },
      {
        month: '2026-03',
        mrr: 499,
        paidClinics: 1,
        registrations: 1,
        appointments: 12,
      },
    ]);
  });
});

describe('resolvePeriod', () => {
  it('defaults to the last 30 IST days and an equal previous window', () => {
    const p = resolvePeriod({}, '2026-09-29');
    expect(p.current).toEqual({ from: '2026-08-31', to: '2026-09-29' });
    expect(p.previous).toEqual({ from: '2026-08-01', to: '2026-08-30' });
  });
});

describe('resolvePeriod bounds', () => {
  it('uses IST calendar days on the stored clock, so 23:30 IST stays on its own day', () => {
    const p = resolvePeriod(
      { from: '2026-09-29', to: '2026-09-29' },
      '2026-09-29'
    );
    expect(p.start.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-09-29T23:59:59.999Z');
    // A row stored as 28 Sep 23:30 IST must fall outside 29 Sep.
    expect(new Date('2026-09-28T23:30:00.000Z') < p.start).toBe(true);
  });
});

describe('liveTrials', () => {
  it('lists unpaid running trials, soonest ending first', () => {
    const trial = (clinicId: string, end: string) =>
      span({
        clinicId,
        isTrial: true,
        monthlyValue: 0,
        planName: 'Clinic',
        startsAt: d('2026-09-01'),
        expiresAt: d(end),
      });
    const s = [
      trial('a', '2026-10-20'),
      trial('b', '2026-10-02'),
      trial('c', '2026-10-05'),
      span({ clinicId: 'c' }),
    ];
    const f = [
      facts({ clinicId: 'a' }),
      facts({ clinicId: 'b' }),
      facts({ clinicId: 'c' }),
    ];
    expect(liveTrials(s, f, d('2026-09-29'))).toEqual([
      { clinicId: 'b', planName: 'Clinic', endsOn: '2026-10-02', daysLeft: 3 },
      { clinicId: 'a', planName: 'Clinic', endsOn: '2026-10-20', daysLeft: 21 },
    ]);
  });
});

describe('plansInUse', () => {
  it('counts each clinic once under its current plan, split by billing', () => {
    const s = [
      span({ clinicId: 'p', planName: 'CareHub' }),
      span({
        clinicId: 't',
        planName: 'Clinic',
        isTrial: true,
        monthlyValue: 0,
        expiresAt: d('2026-10-20'),
      }),
      span({ clinicId: 'f', planName: 'Solo', monthlyValue: 0 }),
      span({ clinicId: 'f2', planName: 'Solo', monthlyValue: 0 }),
    ];
    const f = ['p', 't', 'f', 'f2'].map((clinicId) => facts({ clinicId }));
    expect(plansInUse(s, f, d('2026-09-29'))).toEqual([
      { planName: 'Solo', paid: 0, trial: 0, free: 2, total: 2 },
      { planName: 'CareHub', paid: 1, trial: 0, free: 0, total: 1 },
      { planName: 'Clinic', paid: 0, trial: 1, free: 0, total: 1 },
    ]);
  });
});

describe('fillDays', () => {
  it('returns every day in the range, 0 where there were no rows', () => {
    expect(
      fillDays('2026-09-29', '2026-10-01', [{ day: '2026-09-30', count: 4 }])
    ).toEqual([
      { day: '2026-09-29', count: 0 },
      { day: '2026-09-30', count: 4 },
      { day: '2026-10-01', count: 0 },
    ]);
  });
});
