import type {
  CommissionPeriod,
  CommissionPeriodKind,
} from '../types/patientCommission.types';

export const PERIOD_KINDS = ['monthly', 'half_monthly'] as const;

const toYmd = (d: Date) => d.toISOString().slice(0, 10);

/** `ymd` moved by `days` calendar days; pure date maths, so the server time zone cannot shift it. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

/** The day a pricing change starts: the next period boundary, or the next 1st when the period length changes (the only day that begins a period in both lengths). */
export function changeStartDate(
  today: string,
  current: CommissionPeriodKind,
  target: CommissionPeriodKind
): string {
  return periodContaining(today, current === target ? current : 'monthly')
    .nextStartDate;
}

/** The billing period holding the IST date `ymd` (a calendar month, or its 1st-15th / 16th-end half). */
export function periodContaining(
  ymd: string,
  kind: CommissionPeriodKind
): CommissionPeriod {
  const [year, month, day] = ymd.split('-').map(Number);
  const monthStart = toYmd(new Date(Date.UTC(year, month - 1, 1)));
  const nextMonthStart = toYmd(new Date(Date.UTC(year, month, 1)));
  if (kind === 'half_monthly') {
    const secondHalf = toYmd(new Date(Date.UTC(year, month - 1, 16)));
    const [startDate, nextStartDate] =
      day <= 15 ? [monthStart, secondHalf] : [secondHalf, nextMonthStart];
    return { startDate, endDate: addDays(nextStartDate, -1), nextStartDate };
  }
  return {
    startDate: monthStart,
    endDate: addDays(nextMonthStart, -1),
    nextStartDate: nextMonthStart,
  };
}
