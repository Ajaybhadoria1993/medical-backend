/**
 * Pure queue classification.
 *
 * Kept free of database and Redis access so the rules that decide who is with
 * the doctor, who is next, and who is skipped can be tested directly. This is
 * the part that was previously a one-line `.find(e => e.status === 'Confirmed')`
 * and is where a wrong answer shows up as the doctor and reception disagreeing.
 */

import type {
  DoctorQueueBoard,
  QueueEntry,
  QueuePosition,
} from '../types/queue.types';
import type { HoldReason } from '../services/queueHoldStore.service';
import { applyQueueDemotions, applyQueuePromotions } from './helpers';

export const TERMINAL_STATUSES = new Set(['Completed', 'Cancelled', 'NoShow']);

/** The existing status that means "in the room with the doctor". */
export const WITH_DOCTOR = 'Confirmed';
/** The existing status that means "checked in, waiting". */
export const ARRIVED = 'Patient Arrived';

/**
 * The patient is in the building. `Confirmed` counts: a doctor confirming an
 * appointment means they are seeing that patient.
 *
 * Reads *raw database* statuses, unlike the engine-stamped payloads which use
 * `IN_CONSULTATION` — two different vocabularies.
 */
export function isPresentStatus(status: string): boolean {
  return (
    status === ARRIVED || status === WITH_DOCTOR || status === 'In Consultation'
  );
}

export interface BoardInput {
  id: string;
  patientId: string;
  tokenNo: number | null;
  /** Which shift the token belongs to; absent on callers that predate shifts. */
  sessionIndex?: number | null;
  appointmentTime: string | null;
  appointmentStatus: string;
  /** Places a late check-in moves back; see applyQueueDemotions. */
  lateQueueDemotion?: number | null;
}

/**
 * The order checked-in patients are seen in: token order, late arrivals moved
 * back, then reception's promotions to the front. The one rule for both the
 * board and the patient-facing projection, so the two can't disagree.
 */
export function orderCheckedIn<
  T extends {
    id: string;
    appointmentStatus: string;
    lateQueueDemotion?: number | null;
  },
>(checkedIn: T[], priorityIds: string[]): T[] {
  return applyQueuePromotions(applyQueueDemotions(checkedIn), priorityIds);
}

/**
 * The whole day in the order the board serves it, shift by shift: the patient
 * with the doctor, then checked-in patients (orderCheckedIn), then everyone
 * else in token order. `rows` must arrive in token order. Used by the
 * projection so a patient's "ahead of you" matches what reception sees.
 */
export function orderLikeBoard<
  T extends {
    id: string;
    appointmentStatus: string;
    sessionIndex?: number | null;
    lateQueueDemotion?: number | null;
  },
>(
  rows: T[],
  currentAppointmentId: string | null,
  held: { has(id: string): boolean },
  priorityIds: string[]
): T[] {
  const sessions = Array.from(new Set(rows.map((r) => r.sessionIndex ?? null)));
  return sessions.flatMap((session) => {
    const inSession = rows.filter((r) => (r.sessionIndex ?? null) === session);
    const current = inSession.filter((r) => r.id === currentAppointmentId);
    const checkedIn = inSession.filter(
      (r) =>
        r.id !== currentAppointmentId &&
        !held.has(r.id) &&
        !TERMINAL_STATUSES.has(r.appointmentStatus) &&
        isPresentStatus(r.appointmentStatus)
    );
    const placed = new Set([...current, ...checkedIn]);
    return [
      ...current,
      ...orderCheckedIn(checkedIn, priorityIds),
      ...inSession.filter((r) => !placed.has(r)),
    ];
  });
}

export function buildBoard(
  clinicId: string,
  doctorId: string,
  date: string,
  /** Rows already ordered by token, then scheduled time. */
  rows: BoardInput[],
  /** appointmentId → why they are parked. See queueHoldStore. */
  held: Map<string, HoldReason>,
  /**
   * The appointment with the doctor, from the queue's own pointer — *not* a
   * status. `Confirmed` means the booking was confirmed, which is a different
   * fact and not one reception may assert.
   */
  currentAppointmentId: string | null,
  /**
   * Reception's order for the front of the queue, most recently promoted
   * first. Empty means plain order — token, then scheduled time.
   */
  priorityIds: string[],
  patientNames: Map<string, string>,
  /**
   * The real instant the doctor took the current patient in, from the queue's
   * own timer. Set only on the `with_doctor` entry, since it is the one
   * consultation actually running. Null when nobody is in the room or the key
   * has gone — an absent timer rather than one measured from the scheduled
   * slot, which reads the same whether the doctor started early or not at all.
   */
  consultationStartedAt: string | null = null
): DoctorQueueBoard {
  const toEntry = (row: BoardInput, position: QueuePosition): QueueEntry => ({
    appointmentId: row.id,
    patientId: row.patientId,
    patientName: patientNames.get(row.patientId) ?? 'Unknown',
    tokenNo: row.tokenNo,
    sessionIndex: row.sessionIndex ?? null,
    appointmentTime: row.appointmentTime,
    appointmentStatus: row.appointmentStatus,
    position,
  });

  const completed: QueueEntry[] = [];
  const notArrived: QueueEntry[] = [];
  const onHold: QueueEntry[] = [];
  const available: BoardInput[] = [];
  let currentRow: BoardInput | null = null;

  for (const row of rows) {
    if (TERMINAL_STATUSES.has(row.appointmentStatus)) {
      completed.push(toEntry(row, 'done'));
      continue;
    }

    if (isPresentStatus(row.appointmentStatus)) {
      // The pointer names at most one appointment, so two patients in the room
      // is not representable. A stale pointer matches nothing and reads empty.
      if (row.id === currentAppointmentId) {
        currentRow = row;
        continue;
      }

      const holdReason = held.get(row.id);
      if (holdReason) {
        onHold.push({ ...toEntry(row, 'on_hold'), holdReason });
      } else {
        available.push(row);
      }
      continue;
    }

    // Reception parks patients before they arrive — a phone call saying they
    // are running late is the usual reason, and it lands before the check-in.
    const preArrivalHold = held.get(row.id);
    if (preArrivalHold) {
      onHold.push({ ...toEntry(row, 'on_hold'), holdReason: preArrivalHold });
      continue;
    }

    notArrived.push(toEntry(row, 'not_arrived'));
  }

  /*
   * Reception's promotions go to the front, in the order they were made, and
   * everybody else keeps plain token order behind them. Promoting one patient
   * therefore pushes each of the others down exactly one place — nobody is
   * swapped, and an earlier promotion is not undone by a later one.
   *
   * Stale ids match nothing (called in, held, completed since) and drop out
   * silently, so nothing has to clean the list up.
   */
  const ordered = orderCheckedIn(available, priorityIds);

  // The furthest sitting worked: in the room, or finished. Completed rows
  // count too, so this cannot flip back the moment the room empties.
  const workedSessions = rows
    .filter(
      (row) =>
        row.id === currentAppointmentId || row.appointmentStatus === 'Completed'
    )
    .map((row) => row.sessionIndex)
    .filter((session): session is number => session != null);
  const activeSession = workedSessions.length
    ? Math.max(...workedSessions)
    : null;

  // Reception naming someone is a decision, not an inference, so it outranks
  // the rule above.
  const nextIndex = ordered.findIndex(
    (row) =>
      priorityIds.includes(row.id) ||
      activeSession === null ||
      row.sessionIndex == null ||
      row.sessionIndex >= activeSession
  );

  const waiting = ordered.map((row, index) =>
    toEntry(row, index === nextIndex ? 'next' : 'waiting')
  );

  return {
    clinicId,
    doctorId,
    date,
    currentPatient: currentRow
      ? {
          ...toEntry(currentRow, 'with_doctor'),
          startedAt: consultationStartedAt,
        }
      : null,
    nextPatient: nextIndex === -1 ? null : waiting[nextIndex],
    waiting,
    onHold,
    completed,
    notArrived,
    generatedAt: new Date().toISOString(),
  };
}
