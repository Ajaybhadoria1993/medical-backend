/**
 * Hour-of-day helpers shared by the reports module and the admin dashboard.
 *
 * `appointments.appointment_date` is a timestamp, but the booking flow builds
 * it with `new Date('YYYY-MM-DD')`, so it always lands on midnight UTC — the
 * time of day lives entirely in the separate `appointment_time` varchar.
 * `EXTRACT(HOUR FROM appointment_date)` therefore returns 0 for virtually every
 * row, which is why "peak hours" reported 12 AM. Hour buckets must be derived
 * from `appointment_time` instead.
 *
 * That column is free-form and holds both shapes seen in the wild:
 *   12-hour — "9 AM", "9:00 AM", "09:30 pm"
 *   24-hour — "14:30", "09:00", "14:30:00"
 */

export interface HourBucket {
  hour: number; // 0–23
  cnt: number;
}

const AMPM_RE = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])[Mm]$/;
const HHMM_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/**
 * Parse an `appointment_time` label into a 0–23 clock hour.
 * Returns null for null/blank/unrecognised values so callers can skip the row
 * rather than silently bucket it into hour 0.
 */
export function parseHourFromTimeLabel(
  value: string | null | undefined
): number | null {
  if (!value) return null;
  const t = String(value).trim();
  if (!t) return null;

  const ampm = t.match(AMPM_RE);
  if (ampm) {
    let hour = Number(ampm[1]);
    if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
    const isPm = ampm[3].toLowerCase() === 'p';
    if (hour === 12) hour = 0; // 12 AM -> 0, 12 PM -> 12 (via the +12 below)
    if (isPm) hour += 12;
    return hour;
  }

  const hhmm = t.match(HHMM_RE);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const min = Number(hhmm[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(min) || min < 0 || min > 59) return null;
    return hour;
  }

  return null;
}

/**
 * Fold `GROUP BY appointment_time` rows into hour buckets, busiest first.
 * Rows whose time cannot be parsed are dropped — an unknown time is not
 * evidence of a midnight appointment.
 */
export function bucketRowsByHour(
  rows: { time: string | null; cnt: number | string }[]
): HourBucket[] {
  const totals = new Map<number, number>();

  for (const row of rows ?? []) {
    const hour = parseHourFromTimeLabel(row?.time);
    if (hour === null) continue;
    const count = Number(row.cnt);
    if (!Number.isFinite(count)) continue;
    totals.set(hour, (totals.get(hour) ?? 0) + count);
  }

  return (
    Array.from(totals.entries())
      .map(([hour, cnt]) => ({ hour, cnt }))
      // Ties broken by hour so the output is deterministic across runs.
      .sort((a, b) => b.cnt - a.cnt || a.hour - b.hour)
  );
}

/**
 * Format a 0–23 clock hour as a 12-hour label. Midnight is 12 AM and noon is
 * 12 PM — a naive `h > 12 ? h - 12 : h` renders hour 0 as the nonsensical
 * "0 AM".
 */
export function formatHour12(hour: number): string {
  const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24;
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Zero-padded variant used in time-slot ranges, e.g. "09:00 AM". */
export function formatHourClock12(hour: number): string {
  const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24;
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${String(display).padStart(2, '0')}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

/** One-hour slot label, e.g. "09:00 AM - 10:00 AM" (23:00 wraps to 12:00 AM). */
export function formatHourSlot12(hour: number): string {
  const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24;
  return `${formatHourClock12(h)} - ${formatHourClock12((h + 1) % 24)}`;
}

/** Compact slot label used on chart axes, e.g. "9-10 AM". */
export function formatHourSlotShort(hour: number): string {
  const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24;
  const start = h % 12 === 0 ? 12 : h % 12;
  const nextH = (h + 1) % 24;
  const end = nextH % 12 === 0 ? 12 : nextH % 12;
  return `${start}-${end} ${h < 12 ? 'AM' : 'PM'}`;
}
