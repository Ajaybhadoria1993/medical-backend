import { database } from '../../../configurations/dbConnection';
import { PlanPricingService } from '../services/billing/planPricing.service';
import { couponService } from '../services/coupon.service';
import { OwnerSubscriptionService } from '../services/core/ownerSubscription.service';
import { PlansService } from '../services/core/plans.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../services/coupon.service', () => ({
  couponService: { validateCoupon: jest.fn() },
}));
jest.mock('../services/core/plans.service', () => ({
  PlansService: { currentVersion: jest.fn() },
}));
// GST setting in force; a plain function so resetAllMocks keeps it. Tests switch it with `mockTax`.
let mockTax: { rateBp: number; mode: 'inclusive' | 'exclusive' | 'none' } = {
  rateBp: 1800,
  mode: 'inclusive',
};
jest.mock('../services/billing/tax.service', () => ({
  TaxService: {
    inForce: async () => mockTax,
    splitFor: async () => 'cgst_sgst',
  },
}));
jest.mock('../services/core/ownerSubscription.service', () => ({
  OwnerSubscriptionService: { getCurrent: jest.fn() },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin', 'limit']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const ist = (s: string) => new Date(`${s}T00:00:00+05:30`);

const clinic = {
  id: 'clinic',
  name: 'Clinic',
  slug: 'clinic',
  kind: 'paid',
  isActive: true,
};
const carehub = {
  id: 'carehub',
  name: 'CareHub',
  slug: 'carehub',
  kind: 'paid',
  isActive: true,
};
const prices: Record<
  string,
  { monthlyPrice: string; yearlyPrice: string | null }
> = {
  clinic: { monthlyPrice: '499.00', yearlyPrice: '4790.00' },
  carehub: { monthlyPrice: '999.00', yearlyPrice: null },
};
const now = ist('2026-11-30');
const onClinicMonthly = {
  subscription: {
    id: 'sub-1',
    billingCycle: 'monthly',
    isTrial: false,
    currentPeriodStart: ist('2026-11-15'),
    currentPeriodEnd: ist('2026-12-15'),
    billingAnchorDay: 15,
    scheduledPlanId: null,
  },
  version: { id: 'v-clinic', ...prices.clinic },
  plan: clinic,
  state: { isValid: true },
};

function setup(target: typeof clinic, current: unknown) {
  (database.select as jest.Mock)
    .mockReturnValueOnce(rowsOf([target]))
    .mockReturnValueOnce(rowsOf([]))
    // Add-ons already paid ahead for the renewal period: none.
    .mockReturnValueOnce(rowsOf([]));
  (PlansService.currentVersion as jest.Mock).mockResolvedValue({
    id: `v-${target.id}`,
    ...prices[target.id],
  });
  (OwnerSubscriptionService.getCurrent as jest.Mock).mockResolvedValue(current);
}
const quote = (
  planId: string,
  cycle: 'monthly' | 'yearly',
  couponCode?: string,
  at: Date = now
) =>
  PlanPricingService.quote({
    clinicId: 'c-1',
    planId,
    cycle,
    couponCode,
    now: at,
  });
// 5 days before the 15 Dec period end: inside the renewal window.
const renewDay = ist('2026-12-10');

describe('PlanPricingService.quote', () => {
  // reset, not clear: an unused queued query result would leak into the next test.
  beforeEach(() => jest.resetAllMocks());

  it('adds 18% GST on top when GST is exclusive', async () => {
    mockTax = { rateBp: 1800, mode: 'exclusive' };
    try {
      setup(clinic, null);
      const q = await quote('clinic', 'monthly');
      expect(q).toMatchObject({ amountPaise: 58882, taxPaise: 8982 });
      expect(q.items[q.items.length - 1]).toEqual({
        kind: 'tax',
        description: 'GST 18% (CGST 9% + SGST 9%)',
        amountPaise: 8982,
      });
    } finally {
      mockTax = { rateBp: 1800, mode: 'inclusive' };
    }
  });

  it('first purchase charges the full price for one month', async () => {
    setup(clinic, null);
    const q = await quote('clinic', 'monthly');
    expect(q).toMatchObject({
      case: 'purchase',
      kind: 'plan_purchase',
      amountPaise: 49900,
    });
    expect(q.periodEnd).toEqual(ist('2026-12-30'));
  });

  it('upgrade with 15 of 30 days left pays the difference and keeps the renewal date', async () => {
    setup(carehub, onClinicMonthly);
    const q = await quote('carehub', 'monthly');
    // ₹999 × 15/30 − ₹499 × 15/30 = ₹500 − ₹250 = ₹250
    expect(q).toMatchObject({
      case: 'upgrade',
      kind: 'plan_change',
      amountPaise: 25000,
    });
    expect(q.periodEnd).toEqual(ist('2026-12-15'));
    expect(q.subscriptionId).toBe('sub-1');
  });

  it('monthly → yearly credits the unused days and starts a new year today', async () => {
    setup(clinic, onClinicMonthly);
    const q = await quote('clinic', 'yearly');
    expect(q).toMatchObject({ case: 'to_yearly', amountPaise: 479000 - 24950 });
    expect(q.periodEnd).toEqual(ist('2027-11-30'));
  });

  it('refuses a renewal 15 days before the period ends', async () => {
    setup(clinic, onClinicMonthly);
    await expect(quote('clinic', 'monthly')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('renewal starts at the current period end', async () => {
    setup(clinic, onClinicMonthly);
    const q = await quote('clinic', 'monthly', undefined, renewDay);
    expect(q).toMatchObject({
      case: 'renewal',
      kind: 'renewal',
      amountPaise: 49900,
    });
    expect(q.periodStart).toEqual(ist('2026-12-15'));
    expect(q.periodEnd).toEqual(ist('2027-01-15'));
  });

  it('a plan taken off sale still renews for the clinics on it', async () => {
    setup({ ...clinic, isActive: false }, onClinicMonthly);
    const q = await quote('clinic', 'monthly', undefined, renewDay);
    expect(q).toMatchObject({ case: 'renewal', amountPaise: 49900 });
  });

  it('a plan taken off sale cannot be bought by another clinic', async () => {
    setup({ ...carehub, isActive: false }, onClinicMonthly);
    await expect(quote('carehub', 'monthly')).rejects.toMatchObject({
      status: 400,
      message: 'CareHub is no longer sold.',
    });
  });

  it('refuses a coupon on a renewal', async () => {
    setup(clinic, onClinicMonthly);
    await expect(
      quote('clinic', 'monthly', 'SAVE10', renewDay)
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(couponService.validateCoupon).not.toHaveBeenCalled();
  });

  it('refuses a cycle the plan is not sold in', async () => {
    setup(carehub, null);
    await expect(quote('carehub', 'yearly')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses a cheaper plan as an immediate change', async () => {
    const onCareHub = {
      ...onClinicMonthly,
      version: { id: 'v-carehub', ...prices.carehub },
      plan: carehub,
    };
    setup(clinic, onCareHub);
    await expect(quote('clinic', 'monthly')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('applies a coupon on the plan amount', async () => {
    setup(clinic, null);
    (couponService.validateCoupon as jest.Mock).mockResolvedValue({
      valid: true,
      discountAmount: 49.9,
      coupon: { id: 7 },
    });
    const q = await quote('clinic', 'monthly', 'save10');
    expect(q).toMatchObject({
      discountPaise: 4990,
      amountPaise: 44910,
      couponId: 7,
      couponCode: 'SAVE10',
    });
  });
});
