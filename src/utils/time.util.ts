// Shared time-parsing helpers (wall-clock strings ↔ minutes since midnight).

// normalize date to yyyy-mm-dd
export function normalizeToDateOnly(dateLike: string) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) {
    const m = String(dateLike).match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDayNameFromDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// convert "HH:mm" (24hr) or "hh:mm AM/PM" to minutes since midnight
export function hhmmToMinutes(hhmm: string | null | undefined) {
  if (!hhmm) return null;
  const s = String(hhmm).trim();

  const plainMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (plainMatch) {
    const h = Number(plainMatch[1]);
    const m = Number(plainMatch[2]);
    return h * 60 + m;
  }

  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let h = Number(ampmMatch[1]) % 12;
    const m = Number(ampmMatch[2]);
    if (ampmMatch[3].toLowerCase() === 'pm') h += 12;
    return h * 60 + m;
  }

  const fallback = s.match(/(\d{1,2}):(\d{2})/);
  if (fallback) {
    return Number(fallback[1]) * 60 + Number(fallback[2]);
  }

  return null;
}

export function minutesToIso(dateStr: string, minutes: number) {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${dateStr}T${h}:${m}:00`;
}
