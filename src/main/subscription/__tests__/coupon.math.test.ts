import type { Coupon } from '../models/coupon.model';
import {
  couponDiscountPaise,
  eligibleLines,
  type CouponLine,
} from '../utils/coupon.utils';

const off = (c: Partial<Coupon>, eligiblePaise: number) =>
  couponDiscountPaise(c as Coupon, eligiblePaise);

describe('coupon discount, in paise', () => {
  it('takes a fixed amount off', () => {
    expect(off({ discountType: 'fixed', discountValue: '500' }, 200000)).toBe(
      50000
    );
  });

  it('never takes off more than the eligible amount', () => {
    expect(off({ discountType: 'fixed', discountValue: '500' }, 30000)).toBe(
      30000
    );
  });

  it('takes a percentage off, rounding half up to the paisa', () => {
    expect(
      off({ discountType: 'percentage', discountValue: '12.5' }, 123400)
    ).toBe(15425);
    expect(
      off({ discountType: 'percentage', discountValue: '10' }, 99905)
    ).toBe(9991);
  });

  it('caps a percentage at the maximum discount', () => {
    expect(
      off(
        {
          discountType: 'percentage',
          discountValue: '50',
          maxDiscountAmount: '600',
        },
        200000
      )
    ).toBe(60000);
  });

  it('holds a percentage above 100 to the whole amount', () => {
    expect(
      off({ discountType: 'percentage', discountValue: '150' }, 200000)
    ).toBe(200000);
  });

  it('gives nothing for the retired trial type', () => {
    expect(off({ discountType: 'trial', discountValue: '0' }, 1920000)).toBe(0);
  });
});

describe('lines a coupon applies to', () => {
  const planA = '11111111-1111-4111-8111-111111111111';
  const planB = '22222222-2222-4222-8222-222222222222';
  const addOnA = '33333333-3333-4333-8333-333333333333';
  const plan: CouponLine = { kind: 'plan', planId: planA, amountPaise: 99900 };
  const otherPlan: CouponLine = {
    kind: 'plan',
    planId: planB,
    amountPaise: 99900,
  };
  const addOn: CouponLine = {
    kind: 'addon',
    addOnId: addOnA,
    amountPaise: 49900,
  };
  const on = (c: Partial<Coupon>, lines: CouponLine[]) =>
    eligibleLines(c as Coupon, lines);

  it('"all" covers plan and add-on lines', () => {
    expect(on({ appliesTo: 'all' }, [plan, addOn])).toEqual([plan, addOn]);
  });

  it('a WhatsApp pack is discounted only by an "all" coupon', () => {
    const pack: CouponLine = { kind: 'credits', amountPaise: 24900 };
    expect(on({ appliesTo: 'all' }, [addOn, pack])).toEqual([addOn, pack]);
    expect(on({ appliesTo: 'addons' }, [addOn, pack])).toEqual([addOn]);
    expect(on({ appliesTo: 'plans' }, [pack])).toEqual([]);
  });

  it('"plans" covers only plan lines, every plan when no list is set', () => {
    expect(on({ appliesTo: 'plans' }, [plan, otherPlan, addOn])).toEqual([
      plan,
      otherPlan,
    ]);
  });

  it('"plans" with a list covers only the listed plans', () => {
    expect(
      on({ appliesTo: 'plans', applicablePlanIds: [planA] }, [plan, otherPlan])
    ).toEqual([plan]);
  });

  it('"addons" covers only add-on lines, and its list narrows them', () => {
    expect(on({ appliesTo: 'addons' }, [plan, addOn])).toEqual([addOn]);
    expect(
      on({ appliesTo: 'addons', applicableAddOnIds: ['other'] }, [addOn])
    ).toEqual([]);
  });

  it('reads the old specific_plans spelling as plans with a list', () => {
    expect(
      on({ appliesTo: 'specific_plans', applicablePlanIds: [planA] }, [
        plan,
        otherPlan,
      ])
    ).toEqual([plan]);
  });
});
