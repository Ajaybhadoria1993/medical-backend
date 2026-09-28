import {
  bucketRowsByHour,
  formatHourSlotShort,
} from '../../../utils/appointmentHours.utils';
import type {
  BusiestDayItem,
  BusiestHourItem,
  DoctorPerformanceItem,
  DuesBracket,
  FollowUpGroup,
  FollowUpItem,
  OutstandingDuesItem,
} from '../types/clinicInsights.types';

export const DUES_BRACKETS: DuesBracket[] = ['0-30', '31-60', '61-90', '90+'];
export const FOLLOW_UP_GROUPS: FollowUpGroup[] = [
  'within30',
  '31-90',
  '91-180',
  '180+',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** Busiest first; ties go to revenue then name so the order is stable. */
export function rankDoctors(
  rows: {
    doctorId: string;
    doctor: string | null;
    appointments: number | string;
    completed: number | string;
    revenue: number | string | null;
  }[],
  limit = 5
): DoctorPerformanceItem[] {
  return rows
    .map((r) => {
      const appointments = Number(r.appointments) || 0;
      const completed = Number(r.completed) || 0;
      return {
        doctorId: r.doctorId,
        doctor: r.doctor ?? 'Unknown',
        appointments,
        completed,
        completionRate:
          appointments > 0
            ? Math.round((completed / appointments) * 1000) / 10
            : 0,
        revenue: Math.round(Number(r.revenue) || 0),
      };
    })
    .sort(
      (a, b) =>
        b.appointments - a.appointments ||
        b.revenue - a.revenue ||
        a.doctor.localeCompare(b.doctor)
    )
    .slice(0, limit);
}

/** Every bracket is always present, so the card never reflows as dues clear. */
export function fillDuesBrackets(
  rows: { bracket: string; amount: number | string; count: number | string }[]
): OutstandingDuesItem[] {
  const byBracket = new Map(rows.map((r) => [r.bracket, r]));
  return DUES_BRACKETS.map((bracket) => ({
    bracket,
    amount: Math.round(Number(byBracket.get(bracket)?.amount) || 0),
    count: Number(byBracket.get(bracket)?.count) || 0,
  }));
}

export function topBusiestHours(
  rows: { time: string | null; cnt: number | string }[],
  limit = 5
): BusiestHourItem[] {
  return bucketRowsByHour(rows)
    .slice(0, limit)
    .map(({ hour, cnt }) => ({
      hour,
      label: formatHourSlotShort(hour),
      appointments: cnt,
    }));
}

export function orderBusiestDays(
  rows: { dow: number | string; cnt: number | string }[]
): BusiestDayItem[] {
  const byDow = new Map(rows.map((r) => [Number(r.dow), Number(r.cnt) || 0]));
  return MONDAY_FIRST.map((dow) => ({
    day: DAY_NAMES[dow],
    appointments: byDow.get(dow) ?? 0,
  }));
}

export function fillFollowUpGroups(
  rows: { group: string; patients: number | string }[]
): FollowUpItem[] {
  const byGroup = new Map(rows.map((r) => [r.group, Number(r.patients) || 0]));
  return FOLLOW_UP_GROUPS.map((group) => ({
    group,
    patients: byGroup.get(group) ?? 0,
  }));
}
