export type Cycle = 'monthly' | 'yearly';

export type PricingCase = 'purchase' | 'renewal' | 'upgrade' | 'to_yearly';

export type PricingRefusal =
  | 'yearly_to_monthly'
  | 'not_higher'
  | 'undo_downgrade'
  | 'renew_first'
  | 'too_early';

export const PRICING_REFUSALS: Record<PricingRefusal, string> = {
  yearly_to_monthly:
    'A yearly plan moves to monthly only at the end of the year. Schedule the change from the billing page.',
  not_higher:
    'This plan costs the same or less than yours. Schedule a downgrade from the billing page instead.',
  undo_downgrade:
    'A plan change is scheduled. Undo it to renew or upgrade your current plan.',
  renew_first:
    'Your renewal is due. Renew your current plan first, then change it.',
  too_early:
    'Your plan is already paid for this period. You can renew it in the last 7 days before it ends.',
};

/** A plan can be renewed by hand only this close to its end, so nobody pays a month twice by mistake. */
export const RENEW_WINDOW_DAYS = 7;

export interface PricingCurrent {
  paid: boolean;
  planId: string;
  cycle: Cycle;
  pricePaise: number;
  downgradeScheduled: boolean;
  /** The plan and cycle the clinic moves to at period end; paying for it is the renewal. */
  scheduled?: { planId: string; cycle: Cycle } | null;
  /** In the grace days after the period end. */
  renewalDue?: boolean;
  /** Whole days left in the paid period; unknown means no early-renewal check. */
  daysLeft?: number;
}

/** Free or a trial buys; the same plan and cycle renews; a pricier same-cycle plan upgrades; monthly may go yearly. */
export function pricingCase(
  current: PricingCurrent | null,
  target: { planId: string; cycle: Cycle; pricePaise: number }
): { case: PricingCase } | { refuse: PricingRefusal } {
  if (!current?.paid) return { case: 'purchase' };
  if (current.downgradeScheduled) {
    const s = current.scheduled;
    return s && s.planId === target.planId && s.cycle === target.cycle
      ? { case: 'renewal' }
      : { refuse: 'undo_downgrade' };
  }
  if (current.cycle === 'yearly' && target.cycle === 'monthly') {
    return { refuse: 'yearly_to_monthly' };
  }
  if (current.cycle === 'monthly' && target.cycle === 'yearly') {
    return current.renewalDue
      ? { refuse: 'renew_first' }
      : { case: 'to_yearly' };
  }
  if (target.planId === current.planId) {
    const early =
      !current.renewalDue &&
      current.daysLeft !== undefined &&
      current.daysLeft > RENEW_WINDOW_DAYS;
    return early ? { refuse: 'too_early' } : { case: 'renewal' };
  }
  if (current.renewalDue) return { refuse: 'renew_first' };
  return target.pricePaise > current.pricePaise
    ? { case: 'upgrade' }
    : { refuse: 'not_higher' };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left, counting a started day as left. */
export const daysLeft = (now: Date, end: Date) =>
  Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

/** Calendar days in a period: 28–31 for a month, 365–366 for a year. */
export const daysInPeriod = (start: Date, end: Date) =>
  Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));

/** The share of a price for the days left, in paise, rounded half up; never more than the whole price. */
export const prorate = (pricePaise: number, left: number, period: number) =>
  Math.round((pricePaise * Math.min(left, period)) / period);

/** A trial is paid for as a renewal at its end: same plan, monthly, inside the renewal window. */
export function trialRenews(input: {
  samePlan: boolean;
  cycle: Cycle;
  daysLeft: number;
}) {
  return (
    input.samePlan &&
    input.cycle === 'monthly' &&
    input.daysLeft <= RENEW_WINDOW_DAYS
  );
}
