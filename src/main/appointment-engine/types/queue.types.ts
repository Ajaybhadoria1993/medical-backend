/**
 * Queue module — shared types.
 *
 * The queue deliberately introduces no new appointment status. "With the
 * doctor" is the existing `Confirmed` status (the appointment engine already
 * treats it that way — see DelayTrackerService.recalculate), and "on hold" is
 * a Redis-only flag layered on top of a patient who is still `Patient Arrived`.
 */

/** Where a patient stands in the queue right now, derived — never stored. */
export type QueuePosition =
  /** `Confirmed` — in the room with the doctor. At most one per doctor. */
  | 'with_doctor'
  /** `Patient Arrived`, not held, next by token order. */
  | 'next'
  /** `Patient Arrived`, not held, behind someone else. */
  | 'waiting'
  /** `Patient Arrived` but flagged unavailable by reception. */
  | 'on_hold'
  /** Booked but not checked in yet. */
  | 'not_arrived'
  /** Completed / Cancelled / NoShow. */
  | 'done';

export interface QueueEntry {
  appointmentId: string;
  patientId: string;
  patientName: string;
  tokenNo: number | null;
  /** Which shift the token belongs to; null on time-based or legacy rows. */
  sessionIndex: number | null;
  appointmentTime: string | null;
  /** The untouched lifecycle status, so callers never have to guess. */
  appointmentStatus: string;
  position: QueuePosition;
  /**
   * Only on `on_hold` entries: why they were parked.
   *
   * Hold and skip leave a patient in an identical state, so without this the
   * board cannot say which action put them there — and at the desk the two
   * became indistinguishable the moment the patient landed in the list.
   */
  holdReason?: 'held' | 'skipped';
  /**
   * Only on the `with_doctor` entry: the real instant the doctor took them in.
   *
   * Measuring elapsed time from the scheduled slot instead reported a 12:30
   * appointment begun at 12:25 as "since 0 min" — the same reading whether the
   * doctor started early, on time, or had not started at all.
   *
   * Null when that instant is missing (an evicted key, or a consultation that
   * predates this being recorded), which reads as no timer rather than a wrong
   * one.
   */
  startedAt?: string | null;
}

export interface DoctorQueueBoard {
  clinicId: string;
  doctorId: string;
  date: string;
  /** The one patient with the doctor, or null if the doctor is free. */
  currentPatient: QueueEntry | null;
  /** The patient who should go in next. Never someone on hold. */
  nextPatient: QueueEntry | null;
  waiting: QueueEntry[];
  onHold: QueueEntry[];
  completed: QueueEntry[];
  notArrived: QueueEntry[];
  generatedAt: string;
}
