import { getISTDateString } from '../../../utils/istDateTime';
import type { PeriodQueryDto } from '../schemas/superadminAnalytics.schema';
import type { Period } from '../types/responses.types';

export const DEFAULT_PERIOD_DAYS = 30;

const IST_OFFSET_MS = 330 * 60 * 1000;

/** "Now" on the same clock as zone-less columns (IST wall time read as UTC); compare those only with this. */
export const storedNow = () => new Date(Date.now() + IST_OFFSET_MS);

export const shiftDay = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Same day one month back, clamped to that month's last day (31 Mar → 28/29 Feb). */
const shiftMonth = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, last)))
    .toISOString()
    .slice(0, 10);
};

const storedDayStart = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const storedDayEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999Z`);

const lengthInDays = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** The requested IST range plus the equal-length range just before it, for "vs previous". */
export function resolvePeriod(
  query: PeriodQueryDto,
  today = getISTDateString()
) {
  const to = query.to ?? today;
  const from = query.from ?? shiftDay(today, -(DEFAULT_PERIOD_DAYS - 1));
  const days = lengthInDays(from, to);
  const previous: Period =
    query.compare === 'week'
      ? { from: shiftDay(from, -7), to: shiftDay(to, -7) }
      : query.compare === 'month'
        ? { from: shiftMonth(from), to: shiftMonth(to) }
        : { from: shiftDay(from, -days), to: shiftDay(from, -1) };
  return {
    today,
    current: { from, to } as Period,
    previous,
    // Stored frame (IST wall clock read as UTC), like every zone-less column these are compared with.
    start: storedDayStart(from),
    end: storedDayEnd(to),
    prevStart: storedDayStart(previous.from),
    prevEnd: storedDayEnd(previous.to),
  };
}

/** Every IST day from..to with its count, 0 where nothing happened, so charts have no gaps. */
export function fillDays(
  from: string,
  to: string,
  rows: { day: string; count: number }[]
) {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1))
    out.push({ day: d, count: byDay.get(d) ?? 0 });
  return out;
}
