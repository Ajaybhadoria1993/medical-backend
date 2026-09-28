export type BillingCycle = 'monthly' | 'yearly';

export const PROVIDER_SUBSCRIPTION_ID = {
  monthly: 'carehub-monthly',
  yearly: 'carehub-yearly',
  free: 'free_plan',
} as const;

/**
 * Yearly plans are billed 12 months at a 20% discount.
 *
 * This is the single source of truth for the rate. It previously read 0.1 here
 * while the auto-renew mandate, the plan cards and the "20% OFF" badge all used
 * 0.8 — so a clinic was advertised 20%, charged 10% off on first purchase, then
 * renewed at 20% off. Everything now derives from this constant.
 */
export const YEARLY_DISCOUNT = 0.2;

/**
 * Older rows (and the combined-purchase flow before it was fixed) stored the
 * raw cycle name as `providerSubscriptionId`, so both spellings must resolve.
 */
export const isYearlyProviderId = (
  providerSubscriptionId?: string | null
): boolean =>
  providerSubscriptionId === PROVIDER_SUBSCRIPTION_ID.yearly ||
  providerSubscriptionId === 'pro-yearly' ||
  providerSubscriptionId === 'carehub-yearly' ||
  providerSubscriptionId === 'yearly' ||
  providerSubscriptionId === 'basic-yearly' ||
  providerSubscriptionId?.endsWith('-yearly') === true ||
  providerSubscriptionId?.endsWith('_yearly') === true;

export const billingCycleFromProviderId = (
  providerSubscriptionId?: string | null
): BillingCycle =>
  isYearlyProviderId(providerSubscriptionId) ? 'yearly' : 'monthly';

export const providerIdForCycle = (
  cycle?: BillingCycle | string | null,
  planSlug?: string
) => {
  const isYearly = cycle === 'yearly';
  if (planSlug && planSlug !== 'solo' && planSlug !== 'Free') {
    const baseSlug = planSlug.replace(/-(monthly|yearly)$/, '');
    return isYearly ? `${baseSlug}-yearly` : `${baseSlug}-monthly`;
  }
  return isYearly
    ? PROVIDER_SUBSCRIPTION_ID.yearly
    : PROVIDER_SUBSCRIPTION_ID.monthly;
};

export const planPriceForCycle = (
  monthlyPrice: string | number,
  cycle: BillingCycle
): number =>
  cycle === 'yearly'
    ? Math.round(Number(monthlyPrice) * 12 * (1 - YEARLY_DISCOUNT))
    : Number(monthlyPrice);

/** Days a paid cycle runs for — the same lengths `subscribeClinic` writes. */
export const CYCLE_DAYS: Record<BillingCycle, number> = {
  monthly: 30,
  yearly: 365,
};

/**
 * What a clinic saves by paying yearly instead of twelve monthly instalments.
 * Derived from the two prices rather than restating the rate, so it can never
 * disagree with what is actually charged.
 */
export const yearlySavings = (
  monthlyPrice: string | number,
  cycle: BillingCycle
): number =>
  cycle === 'yearly'
    ? Math.max(
        0,
        planPriceForCycle(monthlyPrice, 'monthly') * 12 -
          planPriceForCycle(monthlyPrice, 'yearly')
      )
    : 0;

/**
 * Unused value left on an active subscription, credited against the next
 * purchase so a mid-cycle switch doesn't silently forfeit days already paid
 * for. Mirrors the daily-rate approach `AddOnService.calculateProRatedPrice`
 * already uses for add-ons.
 *
 * Returns 0 when there is nothing to credit — no expiry, expired already, or a
 * free/zero-price subscription.
 */
export const unusedSubscriptionValue = ({
  pricePaid,
  startsAt,
  expiresAt,
  now = new Date(),
}: {
  pricePaid?: string | number | null;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  now?: Date;
}): { credit: number; remainingDays: number; totalDays: number } => {
  const price = Number(pricePaid ?? 0);
  if (!Number.isFinite(price) || price <= 0 || !expiresAt || !startsAt) {
    return { credit: 0, remainingDays: 0, totalDays: 0 };
  }

  const start = new Date(startsAt);
  const end = new Date(expiresAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { credit: 0, remainingDays: 0, totalDays: 0 };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(
    0,
    Math.ceil((end.getTime() - start.getTime()) / msPerDay)
  );
  const remainingDays = Math.max(
    0,
    Math.ceil((end.getTime() - now.getTime()) / msPerDay)
  );

  if (totalDays <= 0 || remainingDays <= 0) {
    return { credit: 0, remainingDays: 0, totalDays };
  }

  // Never credit more than was paid — a clock skew or a back-dated start must
  // not turn into free money.
  const usableDays = Math.min(remainingDays, totalDays);
  const credit = Math.round((price / totalDays) * usableDays);

  return {
    credit: Math.min(credit, price),
    remainingDays: usableDays,
    totalDays,
  };
};
