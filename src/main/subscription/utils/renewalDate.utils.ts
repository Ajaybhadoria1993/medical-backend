import { IST_OFFSET_MS } from '../../../utils/istDateTime';

export type RenewingCycle = 'monthly' | 'yearly';

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Day of month in IST, not UTC. */
export const anchorDayOf = (date: Date) =>
  new Date(date.getTime() + IST_OFFSET_MS).getUTCDate();

/** Same IST date one month or year on; a short month uses its last day, the next returns to the anchor. */
export function nextPeriodEnd(
  start: Date,
  cycle: RenewingCycle,
  anchorDay: number
): Date {
  const ist = new Date(start.getTime() + IST_OFFSET_MS);
  const months = ist.getUTCMonth() + (cycle === 'yearly' ? 12 : 1);
  const year = ist.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      ist.getUTCHours(),
      ist.getUTCMinutes(),
      ist.getUTCSeconds(),
      ist.getUTCMilliseconds()
    ) - IST_OFFSET_MS
  );
}
