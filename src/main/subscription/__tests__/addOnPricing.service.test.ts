import { database } from '../../../configurations/dbConnection';
import { AddOnPricingService } from '../services/billing/addOnPricing.service';
import { couponService } from '../services/coupon.service';
import { OwnerSubscriptionService } from '../services/core/ownerSubscription.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../services/coupon.service', () => ({
  couponService: { validateCoupon: jest.fn() },
}));
// GST setting in force; a plain function so resetAllMocks keeps it. Tests switch it with `mockTax`.
let mockTax: { rateBp: number; mode: 'inclusive' | 'exclusive' | 'none' } = {
  rateBp: 1800,
  mode: 'inclusive',
};
jest.mock('../services/billing/tax.service', () => ({
  TaxService: { inForce: async () => mockTax, splitFor: async () => 'igst' },
}));
jest.mock('../services/core/ownerSubscription.service', () => ({
  OwnerSubscriptionService: {
    getCurrent: jest.fn(),
    renewalPending: jest.fn(),
  },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'where', 'orderBy']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const ist = (s: string) => new Date(`${s}T00:00:00+05:30`);
const now = ist('2026-11-30');

const onClinicMonthly = {
  subscription: {
    id: 'sub-1',
    billingCycle: 'monthly',
    isTrial: false,
    currentPeriodStart: ist('2026-11-15'),
    currentPeriodEnd: ist('2026-12-15'),
  },
  plan: { id: 'clinic', kind: 'paid' },
  version: { id: 'v-clinic' },
  state: { isValid: true },
};
const doctor = {
  addOn: {
    id: 'doctor',
    name: 'Extra doctor',
    description: null,
    featureKey: 'doctors',
    currency: 'INR',
    monthlyPrice: '199.00',
    yearlyPrice: null,
  },
  monthlyNow: '199.00',
  yearlyNow: null,
  allowed: 'limit-1',
  maxCap: 5,
  owned: 2,
};

function setup(current: unknown, rows: unknown[]) {
  (OwnerSubscriptionService.getCurrent as jest.Mock).mockResolvedValue(current);
  (database.select as jest.Mock).mockReturnValue(rowsOf(rows));
}
const quote = (quantity: number, couponCode?: string) =>
  AddOnPricingService.quote({
    clinicId: 'c-1',
    addOns: [{ addOnId: 'doctor', quantity }],
    couponCode,
    now,
  });

describe('AddOnPricingService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('charges only the days left: ₹199 × 15/30 = ₹99.50', async () => {
    setup(onClinicMonthly, [doctor]);
    const q = await quote(1);
    expect(q.amountPaise).toBe(9950);
    expect(q.items[0]).toMatchObject({
      kind: 'addon',
      addOnId: 'doctor',
      quantity: 1,
      days: 15,
    });
    expect(AddOnPricingService.toResponse(q)).toMatchObject({
      fullPrice: 199,
      subtotal: 99.5,
      totalPayable: 99.5,
    });
  });

  it('with a renewal already at the bank, also charges next month: ₹99.50 + ₹199', async () => {
    setup(onClinicMonthly, [doctor]);
    (OwnerSubscriptionService.renewalPending as jest.Mock).mockResolvedValue({
      periodEnd: ist('2027-01-15'),
    });
    const q = await quote(1);
    expect(q.amountPaise).toBe(9950 + 19900);
    expect(q.items[0]).toMatchObject({
      nextPeriodPaise: 19900,
      periodEnd: ist('2027-01-15').toISOString(),
    });
  });

  it('adds GST on top of the pro-rated price when GST is exclusive', async () => {
    mockTax = { rateBp: 1800, mode: 'exclusive' };
    try {
      setup(onClinicMonthly, [doctor]);
      const q = await quote(1);
      // ₹99.50 + 18% = ₹117.41
      expect(q).toMatchObject({ amountPaise: 11741, taxPaise: 1791 });
      // A clinic in another state: IGST, worded like its invoice.
      expect(AddOnPricingService.toResponse(q).gst).toEqual({
        ratePercent: 18,
        amount: 17.91,
        label: 'GST 18% (IGST)',
      });
    } finally {
      mockTax = { rateBp: 1800, mode: 'inclusive' };
    }
  });

  it('refuses more than the plan cap allows', async () => {
    setup(onClinicMonthly, [doctor]);
    await expect(quote(4)).rejects.toMatchObject({
      status: 400,
      message: 'You can add 3 more Extra doctor on your plan.',
    });
  });

  it('refuses an add-on the plan does not allow', async () => {
    setup(onClinicMonthly, [{ ...doctor, allowed: null, maxCap: null }]);
    await expect(quote(1)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a cycle the add-on is not sold in', async () => {
    const yearly = {
      ...onClinicMonthly,
      subscription: { ...onClinicMonthly.subscription, billingCycle: 'yearly' },
    };
    setup(yearly, [doctor]);
    await expect(quote(1)).rejects.toMatchObject({
      status: 400,
      message: 'Extra doctor is not sold yearly.',
    });
  });

  it('prices an add-on on a trial monthly, pro-rated to the trial end', async () => {
    setup(
      {
        ...onClinicMonthly,
        subscription: {
          ...onClinicMonthly.subscription,
          isTrial: true,
          billingCycle: 'none',
        },
      },
      [doctor]
    );
    // Same days left as the paid month above, so the same ₹99.50.
    await expect(quote(1)).resolves.toMatchObject({ amountPaise: 9950 });
  });

  it('refuses the same add-on twice in one request', async () => {
    await expect(
      AddOnPricingService.quote({
        clinicId: 'c-1',
        addOns: [
          { addOnId: 'doctor', quantity: 1 },
          { addOnId: 'doctor', quantity: 1 },
        ],
        now,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('applies a coupon to the add-on lines', async () => {
    setup(onClinicMonthly, [doctor]);
    (couponService.validateCoupon as jest.Mock).mockResolvedValue({
      valid: true,
      discountAmount: 9.95,
      coupon: { id: 3 },
    });
    const q = await quote(1, 'save10');
    expect(q).toMatchObject({
      discountPaise: 995,
      amountPaise: 8955,
      couponId: 3,
      couponCode: 'SAVE10',
    });
    expect(
      (couponService.validateCoupon as jest.Mock).mock.calls[0][0].lines
    ).toEqual([{ kind: 'addon', addOnId: 'doctor', amountPaise: 9950 }]);
  });

  it('lists add-ons with room left, and blocks them without a paid plan', async () => {
    setup(onClinicMonthly, [doctor]);
    const [paid] = await AddOnPricingService.available('c-1', now);
    expect(paid).toMatchObject({
      owned: 2,
      maxQuantity: 3,
      billingCycles: ['monthly'],
      blockedReason: null,
    });

    setup(null, [{ ...doctor, allowed: null, maxCap: null, owned: null }]);
    const [free] = await AddOnPricingService.available('c-1', now);
    expect(free).toMatchObject({
      maxQuantity: 0,
      blockedReason: 'Add-ons need a paid plan.',
    });
  });
});
