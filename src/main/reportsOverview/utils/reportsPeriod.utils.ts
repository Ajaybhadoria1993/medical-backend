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

export function buildComparisonRange(query: ComparableQuery): {
  primary: DateRange;
  comparison: DateRange;
} {
  const primary: DateRange = {
    start: query.startDate + ' 00:00:00',
    end: query.endDate + ' 23:59:59',
  };

  if (query.compareStartDate && query.compareEndDate) {
    return {
      primary,
      comparison: {
        start: query.compareStartDate + ' 00:00:00',
        end: query.compareEndDate + ' 23:59:59',
      },
    };
  }

  const startMs = new Date(query.startDate).getTime();
  const endMs = new Date(query.endDate).getTime();
  const durationMs = endMs - startMs;
  const compEnd = new Date(startMs - 1);
  const compStart = new Date(startMs - durationMs - 86400000);

  return {
    primary,
    comparison: {
      start: compStart.toISOString().split('T')[0] + ' 00:00:00',
      end: compEnd.toISOString().split('T')[0] + ' 23:59:59',
    },
  };
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
