import { sql } from 'drizzle-orm';
import { comparisonRanges, getISTDateString } from '../../../utils/istDateTime';
import { AppointmentModel } from '../../appointments/models/appointment.model';

export interface DateRange {
  start: string;
  end: string;
}

export interface PeriodSlot {
  date: Date;
  label: string;
}

export interface ChangeResult {
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral' | 'new';
}

interface ComparableQuery {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The dashboard's comparison rule as YYYY-MM-DD days; `primaryEnd` is cut at today when the range runs past it. */
export function previousPeriod(startDate: string, endDate: string) {
  const r = comparisonRanges(startDate, endDate);
  return {
    primaryEnd: ymd(r.compareEnd),
    startDate: ymd(r.prevStart),
    endDate: ymd(r.prevEnd),
  };
}

/** `primary` is the whole selected range; `elapsed` is its part up to today, the side a % compares
 *  with `comparison` (the dashboard rule). Rates and "as of" figures use `elapsed`. */
export function buildComparisonRange(query: ComparableQuery): {
  primary: DateRange;
  elapsed: DateRange;
  comparison: DateRange;
} {
  const primary: DateRange = {
    start: query.startDate + ' 00:00:00',
    end: query.endDate + ' 23:59:59',
  };

  if (query.compareStartDate && query.compareEndDate) {
    return {
      primary,
      elapsed: primary,
      comparison: {
        start: query.compareStartDate + ' 00:00:00',
        end: query.compareEndDate + ' 23:59:59',
      },
    };
  }

  const prev = previousPeriod(query.startDate, query.endDate);
  return {
    primary,
    elapsed: { start: primary.start, end: prev.primaryEnd + ' 23:59:59' },
    comparison: {
      start: prev.startDate + ' 00:00:00',
      end: prev.endDate + ' 23:59:59',
    },
  };
}

const CHANGE_KEY = /change(Type)?$/i;

/** `full` with every `…change`/`…changeType` taken from `elapsed` at the same path. */
function withElapsedChanges<T>(full: T, elapsed: unknown): T {
  if (!full || typeof full !== 'object' || !elapsed) return full;
  if (Array.isArray(full)) {
    return full.map((v, i) =>
      withElapsedChanges(v, (elapsed as unknown[])[i])
    ) as T;
  }
  const from = elapsed as Record<string, unknown>;
  const out = { ...(full as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    out[key] =
      CHANGE_KEY.test(key) && key in from
        ? from[key]
        : withElapsedChanges(out[key], from[key]);
  }
  return out as T;
}

/** Runs `get` for the whole range and, if it runs past today, for the elapsed part:
 *  values come from the whole range, each % from the elapsed part. Arrays must keep a fixed order. */
export async function wholeRangeValues<T>(
  ranges: { primary: DateRange; elapsed: DateRange },
  get: (current: DateRange) => Promise<T>
): Promise<T> {
  if (ranges.elapsed.end === ranges.primary.end) return get(ranges.primary);
  const [full, elapsed] = await Promise.all([
    get(ranges.primary),
    get(ranges.elapsed),
  ]);
  return withElapsedChanges(full, elapsed);
}

/** Joins `fv.first_visit` per patient. Dashboard rule: new = no appointment at the clinic
 *  (with this doctor, if filtered) before the range starts. */
export function firstVisitJoin(clinicId: string, doctorId?: string) {
  return sql`LEFT JOIN (
    SELECT ${AppointmentModel.patientId} AS pid, MIN(${AppointmentModel.appointmentDate}) AS first_visit
    FROM ${AppointmentModel}
    WHERE ${AppointmentModel.clinicId} = ${clinicId}
      ${doctorId ? sql`AND ${AppointmentModel.doctorId} = ${doctorId}` : sql``}
    GROUP BY ${AppointmentModel.patientId}
  ) fv ON fv.pid = ${AppointmentModel.patientId}`;
}

/** The end of `range` capped at today, for figures measured "as of" a day. */
export function asOfEnd(range: DateRange): string {
  const today = getISTDateString();
  return range.end.slice(0, 10) > today ? `${today} 23:59:59` : range.end;
}

export function calcChange(current: number, previous: number): ChangeResult {
  if (previous === 0) {
    return {
      change: 0,
      // Nothing to compare against: "new" rather than a misleading 100% rise.
      changeType: current > 0 ? 'new' : 'neutral',
    };
  }

  const change = parseFloat(
    (((current - previous) / previous) * 100).toFixed(1)
  );

  return {
    change: Math.abs(change),
    changeType: change > 0 ? 'increase' : change < 0 ? 'decrease' : 'neutral',
  };
}

/** A rate's change in percentage points (14% vs 9% → "+5 pts"), never a % of a %. "new" when the
 *  previous period had nothing to measure the rate over. */
export function rateChange(
  current: number,
  previous: number,
  previousHasData: boolean
): ChangeResult {
  if (!previousHasData)
    return { change: 0, changeType: current > 0 ? 'new' : 'neutral' };
  const diff = parseFloat((current - previous).toFixed(1));
  return {
    change: Math.abs(diff),
    changeType: diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'neutral',
  };
}

export function generateSlots(
  start: string,
  end: string,
  period: string
): PeriodSlot[] {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (period === 'monthly' || (period === 'auto' && durationDays > 30)) {
    const slots: PeriodSlot[] = [];
    const current = new Date(startDate);
    const dayOfWeek = current.getDay();
    current.setDate(current.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
    let weekNum = 1;
    while (current <= endDate) {
      slots.push({ date: new Date(current), label: `Week ${weekNum}` });
      current.setDate(current.getDate() + 7);
      weekNum++;
    }
    return slots;
  }

  const slots: PeriodSlot[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    slots.push({
      date: new Date(current),
      label:
        durationDays <= 7
          ? current.toLocaleDateString('en-US', { weekday: 'short' })
          : current.toLocaleDateString('en-US', {
              day: '2-digit',
              month: 'short',
            }),
    });
    current.setDate(current.getDate() + 1);
  }
  return slots;
}

export function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}

export function mapValuesToSlots(
  rows: Array<{ dt: string | Date; value: string | number }>,
  slots: PeriodSlot[],
  truncUnit: string
): number[] {
  const slotKey = (d: Date) =>
    truncUnit === 'week'
      ? `${d.getFullYear()}-W${getISOWeek(d)}`
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const dataMap = new Map<string, number>();
  for (const row of rows) {
    dataMap.set(slotKey(new Date(row.dt)), Math.round(Number(row.value)));
  }

  return slots.map((slot) => dataMap.get(slotKey(slot.date)) || 0);
}

export function padComparisonSlots(
  primarySlots: PeriodSlot[],
  comparisonSlots: PeriodSlot[]
): PeriodSlot[] {
  const padded = [...comparisonSlots];
  while (padded.length < primarySlots.length) {
    padded.push(padded[padded.length - 1] || primarySlots[0]);
  }
  return padded;
}

export function toPercentage(value: number, total: number): number {
  if (!total) return 0;
  return parseFloat(((value / total) * 100).toFixed(1));
}
