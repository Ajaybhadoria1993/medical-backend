import { toPaise } from '../../money';
import type { Coupon } from '../models/coupon.model';

export interface CouponLine {
  kind: 'plan' | 'addon' | 'credits';
  planId?: string;
  addOnId?: string;
  amountPaise: number;
}

type Scope = Pick<
  Coupon,
  'appliesTo' | 'applicablePlanIds' | 'applicableAddOnIds'
>;
type Amount = Pick<
  Coupon,
  'discountType' | 'discountValue' | 'maxDiscountAmount'
>;

// specific_plans / specific_addons are the old spelling of a scope with a list.
const scopeOf = (appliesTo: string) =>
  appliesTo === 'specific_plans'
    ? 'plans'
    : appliesTo === 'specific_addons'
      ? 'addons'
      : appliesTo;

const listed = (list: string[] | null | undefined, id?: string) =>
  !list?.length || (!!id && list.includes(id));

/** The lines a coupon may discount; under `plans` / `addons` an empty list means all of them. */
export function eligibleLines(c: Scope, lines: CouponLine[]): CouponLine[] {
  const scope = scopeOf(c.appliesTo);
  return lines.filter((l) => {
    if (scope === 'all') return true;
    // A credit pack is neither a plan nor an add-on, so only an "all" coupon discounts it.
    if (l.kind === 'credits') return false;
    if (l.kind === 'plan') {
      return scope === 'plans' && listed(c.applicablePlanIds, l.planId);
    }
    return scope === 'addons' && listed(c.applicableAddOnIds, l.addOnId);
  });
}

/** Paise off the eligible amount, rounded half up; a percentage is held to 100 and a retired type gives nothing. */
export function couponDiscountPaise(c: Amount, eligiblePaise: number): number {
  const value = Number(c.discountValue);
  let off = 0;
  if (c.discountType === 'fixed') off = toPaise(value);
  if (c.discountType === 'percentage') {
    off = Math.round((eligiblePaise * Math.min(Math.max(value, 0), 100)) / 100);
    if (c.maxDiscountAmount != null) {
      off = Math.min(off, toPaise(c.maxDiscountAmount));
    }
  }
  return Math.max(0, Math.min(off, eligiblePaise));
}
