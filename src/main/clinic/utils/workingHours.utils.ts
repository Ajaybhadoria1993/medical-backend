import { hhmmToMinutes } from '../../../utils/time.util';
import {
  getISTDateString,
  getISTDayName,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import type {
  DayHours,
  HourInterval,
} from '../types/clinicProfileOverview.types';

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

type AvailabilityRow = {
  dayOfWeek: string;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
};

function mergeIntervals(raw: HourInterval[]): HourInterval[] {
  const sorted = raw
    .map((interval) => ({
      start: hhmmToMinutes(interval.startTime),
      end: hhmmToMinutes(interval.endTime),
      raw: interval,
    }))
    .filter(
      (i): i is { start: number; end: number; raw: HourInterval } =>
        i.start !== null && i.end !== null && i.end > i.start
    )
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number; raw: HourInterval }[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
        last.raw = {
          startTime: last.raw.startTime,
          endTime: current.raw.endTime,
        };
      }
      continue;
    }
    merged.push({ ...current, raw: { ...current.raw } });
  }

  return merged.map((m) => m.raw);
}

/**
 * `clinic_availability` has no clinic-level (doctorId IS NULL) row, so clinic
 * hours are the union of every doctor's windows for that weekday. Every
 * weekday is emitted so an unconfigured day renders as "Closed" rather than
 * silently vanishing from the schedule.
 */
export function buildWeeklyHours(rows: AvailabilityRow[]): DayHours[] {
  const rawByDay = new Map<string, HourInterval[]>();
  for (const row of rows) {
    if (!row.isAvailable || !row.startTime || !row.endTime) continue;
    const bucket = rawByDay.get(row.dayOfWeek) ?? [];
    bucket.push({ startTime: row.startTime, endTime: row.endTime });
    rawByDay.set(row.dayOfWeek, bucket);
  }

  return WEEKDAY_NAMES.map((dayOfWeek) => {
    const intervals = mergeIntervals(rawByDay.get(dayOfWeek) ?? []);
    return { dayOfWeek, intervals, isAvailable: intervals.length > 0 };
  });
}

/**
 * Stored times are clinic wall-clock (IST); deriving "today" in UTC shifts the
 * weekday over after 18:30 IST.
 */
export function resolveTodayHours(week: DayHours[]): DayHours {
  const todayWeekday = getISTDayName(getISTDateString());
  return (
    week.find((day) => day.dayOfWeek === todayWeekday) ?? {
      dayOfWeek: todayWeekday,
      intervals: [],
      isAvailable: false,
    }
  );
}

export function isOpenNow(todayHours: DayHours): boolean {
  const { hours, minutes } = getISTHoursMinutes();
  const nowMinutes = hours * 60 + minutes;

  return todayHours.intervals.some((interval) => {
    const start = hhmmToMinutes(interval.startTime);
    const end = hhmmToMinutes(interval.endTime);
    return (
      start !== null && end !== null && nowMinutes >= start && nowMinutes < end
    );
  });
}
