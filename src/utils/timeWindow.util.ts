/**
 * Shared time-string <-> minutes-since-midnight helpers, plus break-window
 * subtraction, used anywhere a doctor's clinic_availability start/end/break
 * strings need to be resolved into concrete working windows (dashboard
 * today-stats, reception live-queue, etc). Ported from
 * report.service.ts's getFormattedClinicAvailability -> calculateShifts.
 */

export function parseTimeToMinutes(time?: string | null): number | null {
  if (!time) return null;
  const t = time.trim();

  // 12-hour format with AM/PM
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  // 24-hour format HH:MM or HH:MM:SS
  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  const plainNumMatch = t.match(/^(\d{1,2})$/);
  if (plainNumMatch) {
    const hour = Number(plainNumMatch[1]);
    return hour * 60;
  }

  return null;
}

export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function minutesToTime12h(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const clamped = Math.max(0, totalMinutes);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function subtractBreaksFromWindow(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  rawBreaks: { startTime?: string | null; endTime?: string | null }[]
): { start: number; end: number }[] {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin === null || endMin === null || startMin >= endMin) return [];

  const validBreaks = rawBreaks
    .map((b) => {
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);
      if (bStart === null || bEnd === null || bStart >= bEnd) return null;
      return {
        start: Math.max(bStart, startMin),
        end: Math.min(bEnd, endMin),
      };
    })
    .filter((b): b is { start: number; end: number } => Boolean(b))
    .filter((b) => b.end > startMin && b.start < endMin)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const b of validBreaks) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  }

  const windows: { start: number; end: number }[] = [];
  let cursor = startMin;
  for (const br of merged) {
    if (cursor < br.start) windows.push({ start: cursor, end: br.start });
    cursor = Math.max(cursor, br.end);
  }
  if (cursor < endMin) windows.push({ start: cursor, end: endMin });

  return windows;
}
