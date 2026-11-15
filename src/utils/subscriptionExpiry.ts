// src/utils/subscriptionExpiry.ts
import { getISTDateString, startOfDayIST } from './istDateTime';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A plan "until the 14th" works all of the 14th: end of that day in IST, whatever the server zone; null if unusable. */
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
