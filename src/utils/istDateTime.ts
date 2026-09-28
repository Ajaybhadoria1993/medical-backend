/**
 * Shared IST (Asia/Kolkata) date/time helpers.
 *
 * A JS `Date` is always a UTC instant internally — the bug this file fixes is
 * that `new Date().toISOString().split('T')[0]` and `new Date(\`${d}T00:00:00Z\`)`
 * derive the *calendar day* / *day boundary* in UTC, not IST. That silently
 * misclassifies "today" and shifts day boundaries by 5.5h around UTC midnight
 * (00:00-05:29 IST). Appointment-engine "today only" logic must use these
 * helpers instead of raw UTC derivation.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
/** The same offset in milliseconds, for arithmetic on instants. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current IST calendar date as 'YYYY-MM-DD'. */
export function getISTDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: IST_TIMEZONE });
}

/** Current IST time-of-day as 'HH:mm' (24h). */
export function getISTTimeString(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: IST_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Hours/minutes of `date` as observed in IST. */
export function getISTHoursMinutes(date: Date = new Date()): {
  hours: number;
  minutes: number;
} {
  const [hours, minutes] = getISTTimeString(date).split(':').map(Number);
  return { hours, minutes };
}

/** UTC instant corresponding to IST midnight of the given 'YYYY-MM-DD' date. */
export function startOfDayIST(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00${IST_OFFSET}`);
}

/** UTC instant corresponding to a given IST 'HH:mm' wall-clock time on `dateStr`. */
export function istTimeToDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00${IST_OFFSET}`);
}

/**
 * Instant for an appointment's IST wall-clock schedule.
 *
 * `appointments.appointment_date` is stored as UTC midnight of the calendar day
 * (`new Date('YYYY-MM-DD')`) and the rest of the codebase reads that day back
 * with `toISOString().split('T')[0]`, while `appointments.appointment_time` is
 * an IST 'HH:mm' wall-clock string. Combining them with `setHours` applies the
 * time in the *server's* zone (UTC in every container), so a 10:00 appointment
 * becomes 10:00Z and renders as 3:30 PM in any IST-formatted message — the
 * 5h30m shift patients were seeing. Always build the instant through here.
 */
export function appointmentInstantIST(
  appointmentDate: Date | string,
  appointmentTime?: string | null
): Date {
  const base =
    appointmentDate instanceof Date
      ? appointmentDate
      : new Date(appointmentDate);
  const dateStr = base.toISOString().split('T')[0];

  if (!appointmentTime) return startOfDayIST(dateStr);

  const [rawHours, rawMinutes] = appointmentTime.split(':');
  const hours = (rawHours ?? '00').padStart(2, '0');
  const minutes = (rawMinutes ?? '00').padStart(2, '0');
  return istTimeToDate(dateStr, `${hours}:${minutes}`);
}

/** Day-of-week name (e.g. "Monday") for `dateStr`, evaluated in IST. */
export function getISTDayName(dateStr: string): string {
  return startOfDayIST(dateStr).toLocaleDateString('en-US', {
    timeZone: IST_TIMEZONE,
    weekday: 'long',
  });
}

/**
 * UTC instants bounding one IST calendar day, for querying `appointment_date`.
 *
 * `appointment_date` stores **UTC midnight of the IST calendar day**
 * (`new Date('YYYY-MM-DD')`), and that is also what the appointment list
 * endpoint compares against when a client sends `startDate=YYYY-MM-DD`. So a
 * "today" filter has to be built from the IST date, not from
 * `now.getUTCDate()`: between 00:00 and 05:29 IST the UTC date is still
 * yesterday, and a dashboard using it counts the wrong day while the list
 * beside it counts the right one.
 *
 * @param dateStr IST calendar day (defaults to today in IST).
 */
/**
 * ISO instant for a `timestamp`-without-time-zone column holding IST wall time.
 *
 * Columns like `appointment_activity_history.created_at` are declared
 * `timestamp` (no `withTimezone`), and Postgres stores what `NOW()` gave it in
 * the session zone — `Asia/Calcutta` here — with the zone then discarded. The
 * driver hands back a `Date` built as if those digits were the *server's* local
 * time, so calling `.toISOString()` on it re-labels IST as UTC and shifts the
 * value by 5h30m: a consultation begun 17:08 IST rendered as 10:38 PM.
 *
 * Reads the wall-clock fields and rebuilds the instant at the IST offset, which
 * is what the digits actually meant. Null in, null out.
 */
export function istNaiveTimestampToIso(
  value: Date | string | null
): string | null {
  if (!value) return null;

  // A string arrives as Postgres wrote it ('YYYY-MM-DD HH:mm:ss[.ffffff]'),
  // already the wall-clock reading — no local-time round trip to undo.
  if (typeof value === 'string') {
    const [datePart, timePart = '00:00:00'] = value.trim().split(/[T ]/);
    const hhmmss = timePart.split('.')[0];
    const parsed = new Date(`${datePart}T${hhmmss}${IST_OFFSET}`);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (isNaN(value.getTime())) return null;

  /*
   * The driver parses the zone-less digits as UTC, so this Date already reads
   * back as '…17:08:26.000Z' — the IST wall clock mislabelled as UTC, and
   * independent of the process zone (the containers run UTC, dev machines
   * IST). Subtracting the offset turns those digits into the instant they
   * actually named.
   */
  return new Date(value.getTime() - IST_OFFSET_MS).toISOString();
}

export function istDayBoundsUtc(dateStr: string = getISTDateString()): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(`${dateStr}T00:00:00.000Z`),
    end: new Date(`${dateStr}T23:59:59.999Z`),
  };
}
