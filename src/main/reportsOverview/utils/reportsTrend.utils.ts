/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { DateRange, getISOWeek } from './reportsPeriod.utils';
import { IST_TIMEZONE } from '../../../utils/istDateTime';

/** Shared by every Reports tab, so a chart or filter behaves the same on each one. */

export interface Scope {
  department?: string;
  doctorId?: string;
}

/** Joins clinic_services when the Service filter is set; pair with `scopeFilter`. */
export function serviceJoin(query: Scope) {
  return query.department
    ? sql`INNER JOIN ${ClinicServiceModel} ON ${AppointmentModel.clinicServiceId} = ${ClinicServiceModel.id}`
    : sql``;
}

/** Service + Doctor filter on an appointments query, so every card matches the filter bar. */
export function scopeFilter(query: Scope) {
  return sql`${query.doctorId ? sql`AND ${AppointmentModel.doctorId} = ${query.doctorId}` : sql``}
    ${query.department ? sql`AND ${ClinicServiceModel.serviceName} = ${query.department}` : sql``}`;
}

/** An appointment's time of day: IST check-in (`arrived_at` is UTC) else the booked slot. A token not
 *  yet checked in yields its '23:59' placeholder, which `bucketRowsByHour` drops. */
export const knownTimeOfDay = sql`COALESCE(
  TO_CHAR((${AppointmentModel.arrivedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${IST_TIMEZONE}, 'HH24:MI'),
  ${AppointmentModel.appointmentTime}
)`;

/** One chart bucket: `label` for the axis, `detail` for the tooltip ("Wed, 30 Sep 2026"). */
export interface Slot {
  date: Date;
  label: string;
  detail: string;
}

/** "7 Oct 2026", "1–7 Oct 2026" or "28 Sep – 4 Oct 2026" for two calendar days. */
export function spanLabel(from: Date, to: Date): string {
  const dm = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const year = to.getFullYear();
  if (from.getTime() === to.getTime()) return `${dm(to)} ${year}`;
  if (from.getFullYear() !== year)
    return `${dm(from)} ${from.getFullYear()} – ${dm(to)} ${year}`;
  if (from.getMonth() === to.getMonth())
    return `${from.getDate()}–${dm(to)} ${year}`;
  return `${dm(from)} – ${dm(to)} ${year}`;
}

/** 'YYYY-MM-DD…' as a local calendar day, for `spanLabel`. */
export function calendarDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive-ish day count the bucket rules below are tuned for (7-day range → 7). */
export function rangeDays(range: DateRange): number {
  return Math.ceil(
    (new Date(range.end).getTime() - new Date(range.start).getTime()) / 86400000
  );
}

/** An explicit period is honoured literally; 'auto' scales with the span. */
export function resolveTruncUnit(
  period: string,
  durationDays: number
): 'day' | 'week' | 'month' {
  if (period === 'monthly') return 'month';
  if (period === 'weekly') return 'week';
  if (period === 'daily') return 'day';
  if (durationDays > 180) return 'month';
  if (durationDays > 31) return 'week';
  return 'day';
}

/** Every bucket of a range with real-date labels; a week or month cut by the range shows only its days. */
export function generateDateSlots(
  start: string,
  end: string,
  truncUnit: string,
  durationDays: number
): Slot[] {
  const slots: Slot[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  const firstDay = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate()
  );
  const lastDay = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );
  const clipped = (from: Date, to: Date) =>
    spanLabel(from < firstDay ? firstDay : from, to > lastDay ? lastDay : to);

  if (truncUnit === 'month') {
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (current <= endDate) {
      const monthEnd = new Date(
        current.getFullYear(),
        current.getMonth() + 1,
        0
      );
      slots.push({
        date: new Date(current),
        label: current.toLocaleDateString('en-IN', {
          month: 'short',
          year: 'numeric',
        }),
        detail: clipped(current, monthEnd),
      });
      current.setMonth(current.getMonth() + 1);
    }
  } else if (truncUnit === 'week') {
    // Monday-aligned, like date_trunc('week')
    const current = new Date(firstDay);
    const dayOfWeek = current.getDay();
    current.setDate(current.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
    while (current <= endDate) {
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const detail = clipped(current, weekEnd);
      slots.push({
        date: new Date(current),
        label: detail.replace(/ \d{4}$/, ''),
        detail,
      });
      current.setDate(current.getDate() + 7);
    }
  } else {
    const current = new Date(firstDay);
    while (current <= endDate) {
      slots.push({
        date: new Date(current),
        label:
          durationDays <= 7
            ? current.toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
              })
            : current.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              }),
        detail: current.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      });
      current.setDate(current.getDate() + 1);
    }
  }
  return slots;
}

/** Pads a shorter comparison with empty slots (value 0), never a copy of its last slot. */
export function padSlots(
  primarySlots: Slot[],
  comparisonSlots: Slot[]
): Slot[] {
  const padded = [...comparisonSlots];
  while (padded.length < primarySlots.length) {
    padded.push({ date: new Date(NaN), label: '', detail: '' });
  }
  return padded;
}

/** DB rows (`dt`, `cnt`) as a fixed-length array matching `slots`; missing buckets are 0. */
export function mapDataToSlots(
  dbRows: any[],
  slots: Slot[],
  truncUnit: string
): number[] {
  const slotKey = (d: Date) => {
    if (truncUnit === 'month') return `${d.getFullYear()}-M${d.getMonth()}`;
    if (truncUnit === 'week') return `${d.getFullYear()}-W${getISOWeek(d)}`;
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dataMap = new Map<string, number>();
  for (const row of dbRows)
    dataMap.set(slotKey(new Date(row.dt)), Number(row.cnt));
  return slots.map((slot) => dataMap.get(slotKey(slot.date)) || 0);
}

/** Axis labels plus the real dates of both periods, so the tooltip can say what "previous" means. */
export function slotMeta(
  primarySlots: Slot[],
  comparisonSlots: Slot[],
  primary: DateRange,
  comparison: DateRange
) {
  return {
    labels: primarySlots.map((s) => s.label),
    currentDetails: primarySlots.map((s) => s.detail),
    previousDetails: comparisonSlots.map((s) => s.detail),
    currentRange: spanLabel(
      calendarDay(primary.start),
      calendarDay(primary.end)
    ),
    previousRange: spanLabel(
      calendarDay(comparison.start),
      calendarDay(comparison.end)
    ),
  };
}
