/**
 * Shared utility functions for the Appointment Engine.
 */

import { AppointmentStatus, IN_CONSULTATION } from '../types/engine.types';

const REDIS_PREFIX = 'appointment_engine';

const TERMINAL_STATUSES = new Set(['Completed', 'Cancelled', 'NoShow']);
const SHIFTABLE_STATUSES = new Set(['Upcoming', 'Confirmed']);

/**
 * Resolves the effective appointment duration in minutes. The column is a
 * varchar, so it is parsed as an integer, falling back to slotMinutes and
 * finally 30.
 */
export function resolveAppointmentDuration(
  appointmentDurationMinutes: string | null,
  slotMinutes: number | null,
  /**
   * Optional, so existing callers keep their meaning. Most-specific first,
   * since consultation length varies by doctor more than by clinic:
   * a chosen appointment duration → doctorMinutes → slotMinutes →
   * clinicMinutes → 30.
   *
   * `clinicMinutes` sits below slotMinutes deliberately: the slot comes from
   * this doctor's availability row, so it still describes this doctor.
   */
  fallbacks?: {
    doctorMinutes?: number | null;
    clinicMinutes?: number | null;
  }
): number {
  if (appointmentDurationMinutes != null) {
    const parsed = parseInt(appointmentDurationMinutes, 10);
    // A stored value equal to the slot size is the booking grid stamped onto
    // the row, not a length anyone chose — fall through to the measured one.
    if (!isNaN(parsed) && parsed > 0 && parsed !== slotMinutes) {
      return parsed;
    }
  }

  const doctorMinutes = fallbacks?.doctorMinutes;
  if (doctorMinutes != null && doctorMinutes > 0) {
    return doctorMinutes;
  }

  if (slotMinutes != null && slotMinutes > 0) {
    return slotMinutes;
  }

  const clinicMinutes = fallbacks?.clinicMinutes;
  if (clinicMinutes != null && clinicMinutes > 0) {
    return clinicMinutes;
  }

  return 30;
}

/** How many slots of `slotMinutes` (+ `stepMinutes` gap) fit in a window — walked, not a closed-form formula, so it can't drift from the real generator. */
export function deriveSlotCount(
  windowMinutes: number,
  slotMinutes: number,
  stepMinutes: number
): number {
  if (slotMinutes <= 0 || windowMinutes < slotMinutes) return 0;

  const step = Math.max(0, stepMinutes) + slotMinutes;
  let count = 0;
  let cursor = 0;
  while (cursor + slotMinutes <= windowMinutes) {
    count++;
    cursor += step;
  }
  return count;
}

/**
 * Normalises a stored time to `HH:MM`. The column is a varchar, so it arrives
 * as "13:00" from one path and "13:00:00" from another — publishing both made
 * one payload read as two different kinds of value.
 */
export function normalizeTimeString(
  time: string | null | undefined
): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Renders a stored time as a patient reads it — "1:00 PM". Server-side so
 * clients don't each invent their own formatting and disagree.
 */
export function toDisplayTime(time: string | null | undefined): string | null {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;

  const [hourText, minuteText] = normalized.split(':');
  const hours = Number(hourText);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${displayHour}:${minuteText} ${suffix}`;
}

/**
 * Whole minutes from `fromMinutes` until a `HH:MM` time, floored at 0. Null
 * when unparseable, so callers can omit the field rather than publish a
 * fabricated "seen in 0 minutes".
 */
export function minutesUntil(
  time: string | null | undefined,
  fromMinutes: number
): number | null {
  const normalized = normalizeTimeString(time);
  if (!normalized) return null;

  const [hours, minutes] = normalized.split(':').map(Number);
  return Math.max(0, hours * 60 + minutes - fromMinutes);
}

/** A closed window the doctor is unavailable, as minutes since midnight. */
export interface BreakWindow {
  startMinutes: number;
  endMinutes: number;
}

/**
 * The gaps between a day's working windows, as breaks. Nothing else records
 * them: the weekly table is unique on (clinic, day, doctor) so it cannot hold
 * two shifts, and break rows describe the weekly row, not a date's slots.
 *
 * Without the gaps the projection walks straight through the afternoon, so
 * every evening patient reads as hours late and trips running-late
 * notifications. Windows are sorted here rather than assumed ordered;
 * overlapping ones yield no gap rather than a negative one.
 */
export function deriveWindowGaps(
  windows: Array<{ start: number; end: number }>
): BreakWindow[] {
  if (windows.length < 2) return [];

  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const gaps: BreakWindow[] = [];
  let cursor = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start > cursor) {
      gaps.push({ startMinutes: cursor, endMinutes: sorted[i].start });
    }
    cursor = Math.max(cursor, sorted[i].end);
  }

  return gaps;
}

/**
 * Normalises raw break windows: drops incomplete or inverted ones, sorts by
 * start, and merges overlaps so the shift below can walk them once.
 */
export function normalizeBreaks(
  raw: Array<{ startMinutes: number | null; endMinutes: number | null }>
): BreakWindow[] {
  const valid = raw
    .filter(
      (b): b is BreakWindow =>
        b.startMinutes != null &&
        b.endMinutes != null &&
        b.endMinutes > b.startMinutes
    )
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const merged: BreakWindow[] = [];
  for (const window of valid) {
    const last = merged[merged.length - 1];
    if (last && window.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, window.endMinutes);
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
}

/**
 * Moves a start time out of any break it falls inside, to that break's end.
 * Only the start shifts: a consultation beginning before lunch and overrunning
 * isn't pushed, since a real doctor finishes the patient and lunch shortens.
 * Walks rather than shifting once, as one break's end can land inside the next.
 */
export function shiftPastBreaks(
  startMinutes: number,
  // Tolerates a missing list rather than requiring one: this is reached from a
  // Redis-cached day config that predates breaks, and from callers that build
  // a config object by hand. A day with no break data must project exactly as
  // it did before breaks existed, not throw.
  breaks?: BreakWindow[] | null
): number {
  if (!Array.isArray(breaks) || breaks.length === 0) return startMinutes;

  let result = startMinutes;
  for (const window of breaks) {
    if (result >= window.startMinutes && result < window.endMinutes) {
      result = window.endMinutes;
    }
  }

  return result;
}

/**
 * Reorders a queue to honour late-arrival demotions: a demoted appointment
 * moves back `lateQueueDemotion` places among the non-terminal appointments
 * behind it. Terminal ones don't count — moving past three cancelled slots
 * would demote nobody while looking like a penalty in the data.
 *
 * Works on queue order, not `appointmentTime`/`tokenNo`, which stay as the
 * record of what was promised, so a demoted patient's wait grows as it should.
 * Pure and order-stable.
 */
export function applyQueueDemotions<
  T extends {
    appointmentStatus?: string;
    status?: string;
    lateQueueDemotion?: number | null;
  },
>(appointments: T[]): T[] {
  const hasDemotion = appointments.some((a) => (a.lateQueueDemotion ?? 0) > 0);
  if (!hasDemotion) return appointments;

  const result = [...appointments];
  const statusOf = (a: T) => a.appointmentStatus ?? a.status ?? '';

  // Each demoted appointment is moved exactly once. Without this the loop
  // re-encounters it at its new position, sees the same non-zero demotion, and
  // moves it again — every pass pushing it further back until it reaches the
  // end of the queue.
  const alreadyMoved = new Set<T>();

  // Front to back, so a demotion is resolved against the order produced by
  // every demotion ahead of it rather than against the original list — two
  // late patients must not land on the same slot.
  for (let i = 0; i < result.length; i++) {
    const current = result[i];
    const moveBy = current.lateQueueDemotion ?? 0;
    if (moveBy <= 0 || alreadyMoved.has(current)) continue;

    alreadyMoved.add(current);
    result.splice(i, 1);

    // Step over `moveBy` appointments that are live and not themselves demoted:
    // "move back two places" means letting two on-time patients ahead. Counting
    // other late patients would let two cancel each other's penalty, and
    // terminal ones cost the patient nothing to pass.
    let target = i;
    let stepped = 0;
    while (target < result.length && stepped < moveBy) {
      const candidate = result[target];
      const isLive = !isTerminalStatus(statusOf(candidate));
      const isOnTime = (candidate.lateQueueDemotion ?? 0) === 0;
      if (isLive && isOnTime) stepped++;
      target++;
    }

    result.splice(target, 0, current);

    // Re-examine this index: whatever slid down into it has not been seen yet.
    i--;
  }

  return result;
}

/**
 * Builds an appointment-engine Redis key, e.g.
 * `appointment_engine:delay:{clinicId}:{doctorId}:{date}`.
 */
export function getRedisKey(type: string, ...parts: string[]): string {
  return [REDIS_PREFIX, type, ...parts].join(':');
}

/**
 * Checks whether an appointment status is terminal (no longer active in the queue).
 * Terminal statuses: Completed, Cancelled, NoShow
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Checks whether an appointment status is shiftable (eligible for no-show forward shift).
 * Shiftable statuses: Upcoming, Confirmed
 */
export function isShiftableStatus(status: string): boolean {
  return SHIFTABLE_STATUSES.has(status);
}

/**
 * The 4 patient-facing queue stages, plus a terminal "completed" state for
 * appointments that have exited the queue.
 */
export type QueueStage =
  'not-arrived' | 'in-queue' | 'almost-there' | 'consultation' | 'completed';

/**
 * Maps a patient's place in the queue to a patient-facing stage, built for
 * every live-queue payload by buildPayloadFromQueue.
 *
 * not-arrived: booked, not checked in (was `waiting-area`, which read as "in
 * the clinic's waiting room"). in-queue: checked in, >5 ahead, or on hold.
 * almost-there: checked in, <=5 ahead. consultation: with the doctor.
 * completed: any terminal status.
 *
 * `isCheckedIn` is the board's rule (`isPresentStatus`), passed in so this
 * agrees with the payload's own `isCheckedIn`; a held patient has no place in
 * line, so "almost there" would contradict the pause shown beside it.
 */
export function deriveQueueStage(
  status: AppointmentStatus,
  patientsAhead: number,
  { isCheckedIn, isOnHold }: { isCheckedIn: boolean; isOnHold: boolean }
): QueueStage {
  if (isTerminalStatus(status)) return 'completed';
  if (status === IN_CONSULTATION) return 'consultation';
  if (!isCheckedIn) return 'not-arrived';
  if (isOnHold) return 'in-queue';
  return patientsAhead <= 5 ? 'almost-there' : 'in-queue';
}

/**
 * Formats a delay in minutes as "X hour(s) Y minute(s)" once it crosses 60
 * minutes, instead of e.g. "90 minutes" — clearer for patients.
 */
/** "1 patient" / "3 patients". */
export function patientCount(count: number): string {
  return `${count} patient${count === 1 ? '' : 's'}`;
}

export function formatDelayDuration(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourText = `${hours} hour${hours === 1 ? '' : 's'}`;

  if (minutes === 0) {
    return hourText;
  }

  return `${hourText} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * The row's real clock time, or null for a token booking. Token rows carry a
 * '23:59' placeholder that no clock-based path may read as a slot.
 */
export function effectiveAppointmentTime(appt: {
  appointmentTime: string | null;
  tokenNo?: number | null;
}): string | null {
  if (appt.tokenNo == null) return appt.appointmentTime;
  const t = appt.appointmentTime?.trim();
  return t === '23:59' || t === '23:59:00'
    ? null
    : (appt.appointmentTime ?? null);
}

/**
 * Reception's promotions to the front, in the order they were made; everyone
 * else keeps their relative place, so one promotion pushes each other down one.
 */
export function applyQueuePromotions<T extends { id: string }>(
  rows: T[],
  priorityIds: string[]
): T[] {
  if (priorityIds.length === 0) return rows;

  const promoted = priorityIds
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is T => row !== undefined);
  if (promoted.length === 0) return rows;

  const promotedIds = new Set(promoted.map((row) => row.id));
  return [...promoted, ...rows.filter((row) => !promotedIds.has(row.id))];
}
