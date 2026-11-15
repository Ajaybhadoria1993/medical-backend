import {
  addOnLine,
  renewalSummary,
  type AddOnRow,
} from '../utils/subscriptionOverview.utils';

const periodEnd = new Date('2026-12-15T10:00:00+05:30');
const doctor: AddOnRow = {
  id: 'a1',
  addOnName: 'Additional Doctor',
  featureKey: 'additional_doctor',
  quantity: 3,
  scheduledQuantity: null,
  unitValue: 1,
  monthlyPrice: '499.00',
  yearlyPrice: '4790.00',
};
const monthly = { cycle: 'monthly' as const, periodEnd, scheduled: null };

describe('addOnLine', () => {
  it('renews every unit when nothing is scheduled', () => {
    expect(addOnLine(doctor, monthly)).toMatchObject({
      totalQuantity: 3,
      renewalQuantity: 3,
      cancelAtPeriodEnd: false,
      recurringPrice: 1497,
    });
  });

  it('renews the scheduled quantity at period end', () => {
    expect(
      addOnLine({ ...doctor, scheduledQuantity: 1 }, monthly)
    ).toMatchObject({
      renewalQuantity: 1,
      recurringPrice: 499,
    });
  });

  it('marks a fully removed add-on as cancelling', () => {
    expect(
      addOnLine({ ...doctor, scheduledQuantity: 0 }, monthly)
    ).toMatchObject({ renewalQuantity: 0, cancelAtPeriodEnd: true });
  });

  it('prices a yearly plan at the yearly rate', () => {
    expect(
      addOnLine(doctor, { ...monthly, cycle: 'yearly' }).recurringPrice
    ).toBe(14370);
  });

  it('renews nothing when the scheduled plan is Free', () => {
    const changeAt = new Date('2026-12-15T00:00:00+05:30');
    expect(
      addOnLine(doctor, {
        ...monthly,
        scheduled: { isFree: true, changeAt },
      })
    ).toMatchObject({ renewalQuantity: 0, cancelAtPeriodEnd: true });
  });

  it('caps the renewal at the scheduled plan limit, and drops it with no limit row', () => {
    const scheduled = { isFree: false, changeAt: null };
    expect(
      addOnLine(doctor, { ...monthly, scheduled, maxCap: 2 }).renewalQuantity
    ).toBe(2);
    expect(
      addOnLine(doctor, { ...monthly, scheduled, maxCap: null }).renewalQuantity
    ).toBe(3);
    expect(
      addOnLine(doctor, { ...monthly, scheduled, maxCap: undefined })
        .renewalQuantity
    ).toBe(0);
  });
});

describe('renewalSummary', () => {
  const base = {
    planName: 'Clinic',
    planAmount: 999,
    cycle: 'monthly' as const,
    nextChargeDate: periodEnd,
    cancelAtPeriodEnd: false,
    scheduledPlanName: null,
    scheduledPlanChangeAt: null,
  };

  it('adds renewing add-ons to the plan amount', () => {
    const r = renewalSummary({
      ...base,
      addOns: [addOnLine({ ...doctor, scheduledQuantity: 2 }, monthly)],
    });
    expect(r.totalAmount).toBe(999 + 998);
    expect(r.breakdown).toEqual([
      expect.objectContaining({
        type: 'plan',
        name: 'Clinic Plan',
        amount: 999,
      }),
      expect.objectContaining({
        type: 'addon',
        label: 'Additional Doctor ×2',
        quantity: 2,
        unitPrice: 499,
        amount: 998,
      }),
    ]);
  });

  it('adds a GST line when GST is charged on top', () => {
    const r = renewalSummary({
      ...base,
      addOns: [],
      tax: { rateBp: 1800, mode: 'exclusive' },
    });
    expect(r.breakdown[r.breakdown.length - 1]).toMatchObject({
      type: 'tax',
      label: 'GST 18%',
      amount: 179.82,
    });
    expect(r.totalAmount).toBe(1178.82);
  });

  it('adds no GST line when GST is inside the price', () => {
    const r = renewalSummary({
      ...base,
      addOns: [],
      tax: { rateBp: 1800, mode: 'inclusive' },
    });
    expect(r.breakdown).toHaveLength(1);
    expect(r.totalAmount).toBe(999);
  });

  it('shows the AutoPay order already sent, not a later GST change', () => {
    const r = renewalSummary({
      ...base,
      addOns: [],
      tax: { rateBp: 1800, mode: 'exclusive' },
      scheduled: {
        amountPaise: 99900,
        lines: {
          version: 1,
          items: [
            { kind: 'plan', description: 'Clinic Plan', amountPaise: 99900 },
          ],
        },
      },
    });
    expect(r.totalAmount).toBe(999);
    expect(r.breakdown).toEqual([
      expect.objectContaining({ type: 'plan', amount: 999 }),
    ]);
    expect(r.notice).toContain('₹999');
  });

  it('leaves out add-ons that will not renew', () => {
    const r = renewalSummary({
      ...base,
      addOns: [addOnLine({ ...doctor, scheduledQuantity: 0 }, monthly)],
    });
    expect(r.breakdown).toHaveLength(1);
    expect(r.totalAmount).toBe(999);
  });

  it('dates the notice in IST and says AutoPay is off', () => {
    expect(renewalSummary({ ...base, addOns: [] }).notice).toBe(
      "AutoPay is off — you'll need to renew manually (₹999) before 15 Dec 2026 to keep access."
    );
  });

  it('uses the cancellation notice once a cancel is scheduled', () => {
    expect(
      renewalSummary({ ...base, cancelAtPeriodEnd: true, addOns: [] }).notice
    ).toBe(
      'Subscription is scheduled for cancellation. Plan will expire on 15 Dec 2026.'
    );
  });
});
