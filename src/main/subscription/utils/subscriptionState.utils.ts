import { subscriptionGraceEnd } from '../../../utils/subscriptionExpiry';
import type { Subscription } from '../models/ownerSubscription.model';

export type SubscriptionStateName =
  'free' | 'trialing' | 'active' | 'past_due' | 'expired';

export interface SubscriptionState {
  state: SubscriptionStateName;
  isValid: boolean;
  /** Last instant of access: end of the period's last day in IST; null = never ends. */
  validUntil: Date | null;
}

type StateInput = Pick<
  Subscription,
  'status' | 'isTrial' | 'currentPeriodEnd'
> & { planKind: 'free' | 'paid'; cancelAtPeriodEnd?: boolean };

/** Days a due renewal keeps full access before the clinic moves to Free. */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Last instant of access: the period's last day, plus the grace days for a paid plan meant to renew. */
export function accessEnd(sub: StateInput): Date | null {
  const dayEnd = subscriptionGraceEnd(sub.currentPeriodEnd);
  if (!dayEnd) return null;
  // A trial renews into its plan like a paid month, so it gets the same grace days.
  const renews = sub.planKind === 'paid' && !sub.cancelAtPeriodEnd;
  return renews ? new Date(dayEnd.getTime() + GRACE_DAYS * DAY_MS) : dayEnd;
}

const ENDED = new Set(['cancelled', 'expired', 'replaced']);

/** The only place that decides whether a subscription still gives access. */
/** In the grace days after an unpaid period end: the last instant of access; otherwise null. */
export function graceUntil(
  state: SubscriptionState,
  periodEnd: Date | null,
  now: Date = new Date()
): Date | null {
  const lastDay = subscriptionGraceEnd(periodEnd);
  return state.isValid && lastDay && lastDay < now ? state.validUntil : null;
}

export function subscriptionState(
  sub: StateInput,
  now: Date = new Date()
): SubscriptionState {
  if (ENDED.has(sub.status)) {
    return { state: 'expired', isValid: false, validUntil: null };
  }
  if (sub.planKind === 'free') {
    return { state: 'free', isValid: true, validUntil: null };
  }

  const validUntil = accessEnd(sub);
  // The expiry cron may not have run yet, so the end date decides, not the stored status.
  if (validUntil && validUntil.getTime() < now.getTime()) {
    return { state: 'expired', isValid: false, validUntil };
  }

  // Past the period end but inside the grace days: still working, payment due.
  const lastDay = subscriptionGraceEnd(sub.currentPeriodEnd);
  const due = !!lastDay && lastDay.getTime() < now.getTime();
  const state =
    sub.status === 'past_due' || due
      ? 'past_due'
      : sub.isTrial || sub.status === 'trialing'
        ? 'trialing'
        : 'active';
  return { state, isValid: true, validUntil };
}
