import { database } from '../../../configurations/dbConnection';
import { istDaysBetween } from '../../../utils/istDateTime';
import { subscriptionNotify } from '../notify/subscriptionNotify';
import { LifecycleRemindersService } from '../services/core/lifecycleReminders.service';

// Clinic details come through the subscription ports; a fake clinic stands in for the adapter.
jest.mock('../ports', () => ({
  getClinicPort: () => ({
    getClinics: async (ids: string[]) =>
      new Map(
        ids.map((id) => [
          id,
          {
            name: 'Sharma Clinic',
            code: null,
            phone: null,
            ownerUserId: 'u-1',
          },
        ])
      ),
    getBillingParty: async () => null,
    isApproved: async () => true,
    getOwnerContact: async () => ({
      email: 'owner@clinic.test',
      phone: '9999999999',
    }),
  }),
}));
jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../../../utils/logger');
jest.mock('../notify/subscriptionNotify', () => ({
  subscriptionNotify: jest.fn(),
}));
jest.mock('../../notifications/queues/notification.queue', () => ({
  notify: jest.fn(),
}));
jest.mock('../services/core/plans.service', () => ({
  PlansService: {
    currentVersions: jest.fn(
      async () =>
        new Map([
          ['clinic', { monthlyPrice: '499.00', yearlyPrice: '4790.00' }],
        ])
    ),
  },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const ist = (s: string) => new Date(`${s}+05:30`);

describe('istDaysBetween', () => {
  it('counts IST calendar days, whatever the time of day', () => {
    expect(
      istDaysBetween(ist('2026-11-04T23:50:00'), ist('2026-11-05T00:10:00'))
    ).toBe(1);
    expect(
      istDaysBetween(ist('2026-11-04T07:00:00'), ist('2026-11-11T23:00:00'))
    ).toBe(7);
    expect(
      istDaysBetween(ist('2026-11-04T07:00:00'), ist('2026-11-04T23:00:00'))
    ).toBe(0);
  });
});

describe('LifecycleRemindersService', () => {
  beforeEach(() => jest.clearAllMocks());
  const now = ist('2026-11-04T07:00:00');
  const sub = {
    clinicId: 'c-1',
    isTrial: false,
    billingCycle: 'monthly',
    cancelAtPeriodEnd: false,
    scheduledPlanId: null,
    planId: 'clinic',
    planName: 'Clinic',
    kind: 'paid',
    clinicName: 'Sharma Clinic',
    adminUserId: 'u-1',
  };

  it('sends trial and renewal reminders only on their days, and none after a cancel', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(
      rowsOf([
        {
          ...sub,
          id: 'trial',
          isTrial: true,
          periodEnd: ist('2026-11-07T09:00:00'),
        }, // 3 days → trial_ending
        { ...sub, id: 'renew', periodEnd: ist('2026-11-11T09:00:00') }, // 7 days → renewal_reminder
        { ...sub, id: 'quiet', periodEnd: ist('2026-11-09T09:00:00') }, // 5 days → nothing
        {
          ...sub,
          id: 'cancelled',
          cancelAtPeriodEnd: true,
          periodEnd: ist('2026-11-05T09:00:00'),
        }, // chose not to renew
      ])
    );
    // Add-ons of the due subscriptions: 2 extra doctors at ₹199 on the one that renews.
    (database.select as jest.Mock).mockReturnValueOnce(
      rowsOf([
        {
          subscriptionId: 'renew',
          quantity: 2,
          scheduledQuantity: null,
          monthlyPrice: '199.00',
          yearlyPrice: null,
        },
      ])
    );
    const r = await LifecycleRemindersService.run(now);
    const events = (subscriptionNotify as jest.Mock).mock.calls.map((c) => [
      c[0],
      c[2].split('|')[0],
    ]);
    expect(events).toEqual([
      ['subscription.trial_ending', 'trial'],
      ['subscription.renewal_reminder', 'renew'],
    ]);
    expect(r).toMatchObject({ checked: 4, queued: 2, errors: [] });
    // ₹499 plan + 2 × ₹199 add-ons, the amount the renewal will charge.
    expect((subscriptionNotify as jest.Mock).mock.calls[1][1]).toMatchObject({
      amount: '897.00',
    });
  });

  it('tells a clinic about a price rise only, once per version', async () => {
    (database.select as jest.Mock).mockReturnValue(
      rowsOf([
        {
          clinicId: 'up',
          billingCycle: 'monthly',
          monthlyPrice: '499.00',
          yearlyPrice: null,
          planName: 'Clinic',
        },
        {
          clinicId: 'same',
          billingCycle: 'yearly',
          monthlyPrice: null,
          yearlyPrice: '4790.00',
          planName: 'Clinic',
        },
      ])
    );
    await LifecycleRemindersService.priceChange({
      id: 'v2',
      planId: 'clinic',
      monthlyPrice: '599.00',
      yearlyPrice: '4790.00',
      effectiveFrom: ist('2026-12-01T00:00:00'),
    });
    expect(subscriptionNotify).toHaveBeenCalledTimes(1);
    expect(subscriptionNotify).toHaveBeenCalledWith(
      'subscription.price_change',
      expect.objectContaining({
        clinicId: 'up',
        oldPrice: '499.00',
        newPrice: '599.00',
      }),
      'up|v2'
    );
  });
});
