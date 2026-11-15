import { AutoPayRenewalService } from '../services/billing/autoPayRenewal.service';
import { OwnerSubscriptionService } from '../services/core/ownerSubscription.service';

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
jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../utils/logger');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-05T09:00:00Z');
const mandate = {
  ownerId: 'c1',
  providerTokenId: 'token_1',
  maxAmountPaise: 99800,
} as never;

const onPlan = (
  endsInDays: number,
  extra: Record<string, unknown> = {},
  failed = 0
) => {
  jest.spyOn(AutoPayRenewalService, 'failedTries').mockResolvedValue(failed);
  return jest.spyOn(OwnerSubscriptionService, 'getCurrent').mockResolvedValue({
    state: { isValid: true },
    plan: { kind: 'paid', id: 'p1', name: 'Clinic' },
    subscription: {
      id: 's1',
      isTrial: false,
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(now.getTime() + endsInDays * DAY),
      cancelAtPeriodEnd: false,
      scheduledPlanId: null,
      ...extra,
    },
  } as never);
};

describe('AutoPay renewal window', () => {
  afterEach(() => jest.restoreAllMocks());

  it('waits until 51 hours before the renewal date', async () => {
    onPlan(4);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_due'
    );
    jest.restoreAllMocks();
    // 60 h before: inside the old 3-day window, outside the new one.
    onPlan(2.5);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_due'
    );
  });

  it('never starts a first charge inside the 27-hour notice window', async () => {
    onPlan(0.5);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_due'
    );
  });

  it('stops after 3 tries, and retries only until the grace days end', async () => {
    onPlan(2, {}, 3);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'gave_up'
    );
    jest.restoreAllMocks();
    onPlan(-4, {}, 1);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_due'
    );
    jest.restoreAllMocks();
    // A first charge never starts after the period end, even in grace.
    onPlan(-1, {}, 0);
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_due'
    );
  });

  it('skips a yearly plan, a plan set to end, and a scheduled change', async () => {
    onPlan(2, { billingCycle: 'yearly' });
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_eligible'
    );
    onPlan(2, { cancelAtPeriodEnd: true });
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_eligible'
    );
    onPlan(2, { scheduledPlanId: 'p2' });
    await expect(AutoPayRenewalService.renew(mandate, now)).resolves.toBe(
      'not_eligible'
    );
  });
});
