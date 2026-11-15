import { database } from '../../../configurations/dbConnection';
import { SubscriptionReadService } from '../services/core/subscriptionRead.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit'])
    q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const version = { monthlyPrice: '499.00', yearlyPrice: '4790.00' };
const sub = (over: Record<string, unknown>) => ({
  ownerId: 'c-1',
  billingCycle: 'monthly',
  isTrial: false,
  status: 'active',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  currentPeriodStart: new Date('2026-11-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
  endedAt: null,
  ...over,
});

describe('SubscriptionReadService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('turns rows without payments into spans with their monthly value', async () => {
    (database.select as jest.Mock)
      .mockReturnValueOnce(
        rowsOf([
          {
            subscription: sub({ id: 's-1' }),
            version,
            plan: { name: 'Clinic', kind: 'paid' },
          },
          {
            subscription: sub({ id: 's-2', billingCycle: 'yearly' }),
            version,
            plan: { name: 'Clinic', kind: 'paid' },
          },
          {
            subscription: sub({
              id: 's-3',
              isTrial: true,
              status: 'replaced',
              endedAt: new Date('2026-10-15T00:00:00Z'),
            }),
            version,
            plan: { name: 'Clinic', kind: 'paid' },
          },
          {
            subscription: sub({ id: 's-4', billingCycle: 'none' }),
            version: { monthlyPrice: null, yearlyPrice: null },
            plan: { name: 'Solo', kind: 'free' },
          },
        ])
      )
      // No captured payments (carried-over plans): the paid rows fall back to themselves.
      .mockReturnValueOnce(rowsOf([]));
    const spans = await SubscriptionReadService.spans();
    expect(
      spans.map((s) => [s.monthlyValue, s.isPaid, s.isTrial, s.isFreePlan])
    ).toEqual([
      [423, false, true, false],
      [0, false, false, true],
      [423, true, false, false],
      [338, true, false, false], // ₹4,790 a year incl. 18% GST is ₹338 a month without GST
    ]);
    // An ended row stops when it ended, not at its old period end.
    expect(spans[0].expiresAt).toEqual(new Date('2026-10-15T00:00:00Z'));
  });

  it('shows an upgrade as a change and a renewal paid ahead from its own start', async () => {
    const d = (x: string) => new Date(`${x}T00:00:00Z`);
    const plan = (v: string) => ({
      kind: 'plan',
      planVersionId: v,
      billingCycle: 'monthly',
      amountPaise: 0,
      description: '',
    });
    (database.select as jest.Mock)
      .mockReturnValueOnce(
        rowsOf([
          {
            subscription: sub({ id: 's-1', createdAt: d('2026-11-05') }),
            version,
            plan: { name: 'CareHub', kind: 'paid' },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          {
            subscriptionId: 's-1',
            periodStart: d('2026-11-05'),
            periodEnd: d('2026-12-05'),
            paidAt: d('2026-11-05'),
            lines: { items: [plan('v-clinic')] },
          },
          // Upgrade on 6 Nov keeps the period end.
          {
            subscriptionId: 's-1',
            periodStart: d('2026-11-06'),
            periodEnd: d('2026-12-05'),
            paidAt: d('2026-11-06'),
            lines: { items: [plan('v-carehub')] },
          },
          // Next month paid ahead: it starts on 5 Dec, not on the day it was paid.
          {
            subscriptionId: 's-1',
            periodStart: d('2026-12-05'),
            periodEnd: d('2027-01-05'),
            paidAt: d('2026-11-06'),
            lines: { items: [plan('v-carehub')] },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          {
            version: {
              id: 'v-clinic',
              monthlyPrice: '499.00',
              yearlyPrice: null,
            },
            plan: { name: 'Clinic', kind: 'paid' },
          },
          {
            version: {
              id: 'v-carehub',
              monthlyPrice: '999.00',
              yearlyPrice: null,
            },
            plan: { name: 'CareHub', kind: 'paid' },
          },
        ])
      );
    const spans = await SubscriptionReadService.spans();
    expect(
      spans.map((s) => [s.planName, s.monthlyValue, s.startsAt, s.expiresAt])
    ).toEqual([
      ['Clinic', 423, d('2026-11-05'), d('2026-11-06')],
      ['CareHub', 847, d('2026-11-06'), d('2026-12-05')],
      ['CareHub', 847, d('2026-12-05'), d('2027-01-05')],
    ]);
  });

  it('counts a coupon month at what was paid, and the renewal after it at full price', async () => {
    const d = (x: string) => new Date(`${x}T00:00:00Z`);
    const line = {
      kind: 'plan',
      planVersionId: 'v-carehub',
      billingCycle: 'monthly',
      amountPaise: 99900,
      description: '',
    };
    (database.select as jest.Mock)
      .mockReturnValueOnce(
        rowsOf([
          {
            subscription: sub({ id: 's-1' }),
            version,
            plan: { name: 'CareHub', kind: 'paid' },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          // 50% coupon on the first month.
          {
            subscriptionId: 's-1',
            periodStart: d('2026-11-01'),
            periodEnd: d('2026-12-01'),
            paidAt: d('2026-11-01'),
            discountPaise: 49950,
            lines: {
              items: [
                line,
                { kind: 'coupon', amountPaise: -49950, description: '' },
              ],
            },
          },
          {
            subscriptionId: 's-1',
            periodStart: d('2026-12-01'),
            periodEnd: d('2027-01-01'),
            paidAt: d('2026-12-01'),
            discountPaise: 0,
            lines: { items: [line] },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          {
            version: {
              id: 'v-carehub',
              monthlyPrice: '999.00',
              yearlyPrice: null,
            },
            plan: { name: 'CareHub', kind: 'paid' },
          },
        ])
      );
    const spans = await SubscriptionReadService.spans();
    // ₹999 incl. 18% GST is ₹847 without GST; half of it in the coupon month.
    expect(spans.map((s) => s.monthlyValue)).toEqual([423, 847]);
  });

  it('counts add-ons as monthly revenue, not as new plan starts', async () => {
    const d = (x: string) => new Date(`${x}T00:00:00Z`);
    const planLine = {
      kind: 'plan',
      planVersionId: 'v-clinic',
      billingCycle: 'monthly',
      amountPaise: 49900,
      description: '',
    };
    (database.select as jest.Mock)
      .mockReturnValueOnce(
        rowsOf([
          {
            subscription: sub({ id: 's-1' }),
            version,
            plan: { name: 'Clinic', kind: 'paid' },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          {
            subscriptionId: 's-1',
            periodStart: d('2026-11-05'),
            periodEnd: d('2026-12-05'),
            paidAt: d('2026-11-05'),
            lines: { items: [planLine] },
          },
          // 3 extra doctors bought mid-period: the line holds only the pro-rated amount.
          {
            subscriptionId: 's-1',
            periodStart: null,
            periodEnd: null,
            paidAt: d('2026-11-15'),
            lines: {
              items: [
                {
                  kind: 'addon',
                  addOnId: 'doc',
                  quantity: 3,
                  billingCycle: 'monthly',
                  amountPaise: 99800,
                  days: 20,
                  periodStart: '2026-11-15T00:00:00.000Z',
                  periodEnd: '2026-12-05T00:00:00.000Z',
                  description: '',
                },
              ],
            },
          },
          // The renewal charges the plan and the add-on in full.
          {
            subscriptionId: 's-1',
            periodStart: d('2026-12-05'),
            periodEnd: d('2027-01-05'),
            paidAt: d('2026-12-02'),
            lines: {
              items: [
                planLine,
                {
                  kind: 'addon',
                  addOnId: 'doc',
                  quantity: 3,
                  billingCycle: 'monthly',
                  amountPaise: 149700,
                  description: '',
                },
              ],
            },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([
          {
            version: {
              id: 'v-clinic',
              monthlyPrice: '499.00',
              yearlyPrice: null,
            },
            plan: { name: 'Clinic', kind: 'paid' },
          },
        ])
      )
      .mockReturnValueOnce(
        rowsOf([{ id: 'doc', monthly: '499.00', yearly: null }])
      );
    const spans = await SubscriptionReadService.spans();
    const addOns = spans.filter((s) => s.continues && s.monthlyValue === 1269);
    // ₹499 × 3 a month, both for the mid-period purchase and the renewal line.
    expect(addOns.map((s) => [s.startsAt, s.expiresAt, s.planName])).toEqual([
      [d('2026-11-15'), d('2026-12-05'), 'Clinic'],
      [d('2026-12-05'), d('2027-01-05'), 'Clinic'],
    ]);
    // Only the first Clinic span is a plan start; the renewal continues it.
    expect(
      spans.filter((s) => s.monthlyValue === 423).map((s) => s.continues)
    ).toEqual([false, true]);
  });

  it('anchors the credits allowance to the current period start', async () => {
    (database.select as jest.Mock).mockReturnValue(
      rowsOf([{ start: new Date('2026-11-01T00:00:00Z'), endedAt: null }])
    );
    expect(await SubscriptionReadService.billingAnchor('c-1')).toEqual(
      new Date('2026-11-01T00:00:00Z')
    );
  });
});
