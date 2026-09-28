// src/utils/subscriptionExpiry.ts
import { getISTDateString, startOfDayIST } from './istDateTime';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Single source of truth for "is this subscription still valid?".
 *
 * Three places used to answer this differently, and a clinic could sit in the
 * gap between them for hours:
 *   - `clinic.service` pushed `expiresAt` to end-of-day before comparing, so
 *     GET /clinic/user still reported the paid plan;
 *   - `requireUserSubscription` compared the raw timestamp, so the same clinic
 *     got a 403 (and the FE force-logged them out);
 *   - `getClinicSubscription` also compared the raw timestamp, so the billing
 *     screen showed no active plan.
 *
 * End-of-day is the rule we keep: a plan that "expires on the 14th" is expected
 * to work for all of the 14th, not until 11:19 that morning.
 *
 * The day boundary is resolved in IST, not the server's local timezone. The old
 * inline `setHours(23, 59, 59, 999)` used whatever timezone the process ran in,
 * so a UTC container and an IST dev machine disagreed by 5½ hours about when a
 * subscription lapsed.
 */

/**
 * The instant a subscription stops being valid — the end of its expiry day in
 * IST. Returns null when the input isn't a usable date.
 */
export function subscriptionGraceEnd(
  expiresAt: Date | string | null | undefined
): Date | null {
  if (expiresAt === null || expiresAt === undefined) return null;

  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;

  // Last millisecond of that IST calendar day.
  return new Date(startOfDayIST(getISTDateString(date)).getTime() + DAY_MS - 1);
}

/**
 * Whether a subscription is still valid.
 *
 * A null/undefined `expiresAt` means "never expires" — that is how the Free
 * plan is stored (see `SubscriptionService.subscribeClinic`) and must be
 * treated as valid, not as missing data.
 *
 * An unparseable value is treated as expired: it is not a licence to grant
 * access on malformed input.
 */
export function isSubscriptionValid(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;

  const graceEnd = subscriptionGraceEnd(expiresAt);
  if (!graceEnd) return false;

  return graceEnd.getTime() >= now.getTime();
}
