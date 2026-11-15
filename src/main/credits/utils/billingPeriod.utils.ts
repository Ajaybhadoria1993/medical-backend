import type { BillingPeriod } from '../types/credits.types';

const IST_OFFSET_MS = 330 * 60 * 1000;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const clampDay = (year: number, month: number, day: number) =>
  Math.min(day, daysInMonth(year, month));

const istMidnight = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);

/** The billing month containing `now`, renewing on the anchor's IST day of month.
 *  Days 29–31 fall on the last day of shorter months; the first period starts at the anchor itself. */
export function billingPeriod(anchor: Date, now: Date): BillingPeriod {
  const day = new Date(anchor.getTime() + IST_OFFSET_MS).getUTCDate();
  const today = new Date(now.getTime() + IST_OFFSET_MS);

  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  if (today.getUTCDate() < clampDay(year, month, day)) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }

  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const start = istMidnight(year, month, clampDay(year, month, day));

  return {
    start: new Date(Math.max(start.getTime(), anchor.getTime())),
    end: istMidnight(nextYear, nextMonth, clampDay(nextYear, nextMonth, day)),
  };
}

/** IST days `from`..`to` (YYYY-MM-DD, inclusive) as real instants, `end` exclusive.
 *  Not istDayBoundsUtc: that one is for zone-less IST columns; ours are timestamptz. */
export function istDateRange(from: string, to: string): BillingPeriod {
  const [y, m, d] = to.split('-').map(Number);
  return {
    start: new Date(`${from}T00:00:00+05:30`),
    end: istMidnight(y, m - 1, d + 1),
  };
}

/** True when this message moved usage from below the warning point to at or above it. */
export function crossedWarning(
  usedBefore: number,
  usedAfter: number,
  limit: number,
  warnPercent: number
): boolean {
  if (limit <= 0) return false;
  const point = (limit * warnPercent) / 100;
  return usedBefore < point && usedAfter >= point;
}
