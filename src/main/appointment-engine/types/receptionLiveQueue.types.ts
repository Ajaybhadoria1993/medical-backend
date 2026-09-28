/**
 * The reception live-queue board.
 *
 * This is the *view* of a clinic's queues: roster, availability, and every
 * derived fact the screens need to render and act. It is composed from
 * `QueueService` (which stays the single writer and the keeper of positions
 * and holds) rather than re-deriving the queue from delay data — two
 * implementations of "who is with the doctor" is exactly how the doctor's
 * screen and reception's came to disagree.
 *
 * Rules live here, not on the client. Anything a screen would otherwise have
 * to work out — who an action applies to, whether a patient has checked in,
 * whether a delay is still worth announcing — is answered in this payload, so
 * two clients cannot answer it differently.
 */

export interface LiveQueueEntry {
  /** The real appointment id, so a control has something to act on. */
  appointmentId: string;
  patientName: string;
  /** tokenNo (as string) if present, else appointmentTime, else '-'. */
  slot: string;
  /**
   * `Patient Arrived` — the patient is in the building.
   *
   * Every queue action (send-in, hold, skip) refuses a patient who has not
   * checked in, so this is what decides whether a control can target them.
   */
  isCheckedIn: boolean;
  /** Their shift closed before their turn came: move or reschedule, never check in. */
  isMissedSession: boolean;
  /** 1-based shift of a token; null on a time-based or legacy row. */
  sessionIndex: number | null;
  /**
   * Only on `onHold` entries: which action parked them. Hold and skip leave a
   * patient identical, so this is what lets the card label the row.
   */
  holdReason?: 'held' | 'skipped';
}

export interface LiveQueueCurrentEntry extends LiveQueueEntry {
  /**
   * When the doctor actually took this patient in — the instant `send-in`
   * records, which is what the "since N min" reading measures against.
   *
   * Falls back to the patient's **scheduled** slot only when that instant is
   * missing: an evicted Redis key, or a consultation started before this was
   * recorded. The fallback keeps a timer on screen rather than blanking it,
   * but it under-reports an early start — a 12:30 appointment begun at 12:25
   * would read 0 minutes instead of 5.
   */
  startedAt: string | null;
}

export interface DoctorLiveQueue {
  doctorId: string;
  name: string;
  profilePhoto: string | null;
  speciality: string | null;
  /**
   * Follows the queue, not the roster: a doctor is `Consulting` when someone
   * is actually with them. Availability says whether they are working now,
   * which stays true between patients and so cannot answer this.
   */
  status: 'Consulting' | 'Available';
  /** Whether the doctor is inside their working hours right now. */
  isAvailableNow: boolean;
  /** Whoever is with the doctor. */
  currentRunning: LiveQueueCurrentEntry | null;
  /**
   * Everyone still ahead of the doctor today — checked-in patients first, then
   * those still expected. Reception needs the whole day, not only who has
   * walked in, so the order carries the meaning: anyone who can be called now
   * sits above anyone who cannot. Held patients are excluded.
   */
  nextInQueue: LiveQueueEntry[];
  /** Patients reception has parked. Only `Resume` brings them back. */
  onHold: LiveQueueEntry[];
  /** Checked-in patients waiting — the count that can actually be called in. */
  waitingCount: number;
  /** Everyone in `nextInQueue`, arrived or not. */
  totalWaiting: number;
  /** Who `call`, `hold` and `skip` apply to: the board's own next patient — the
   * one the doctor's screen shows, so it skips a shift already worked past. */
  actionTarget: string | null;
  /** Who `check-in` applies to: the first patient still expected whose shift is
   * still open. */
  checkInTarget: string | null;
  /**
   * Whether a running-late announcement is still worth making: patients are
   * booked and none of them has arrived. It tells people who have not set off
   * to come later, which is worthless once they are sitting in reception.
   */
  canAnnounceLate: boolean;
  /** The day's shifts ("HH:MM") on a split-shift token day; empty otherwise. */
  sessions: Array<{
    sessionIndex: number;
    start: string;
    end: string;
    /** Only on a shift right after one with missed patients: room for moving them in. */
    capacity?: number;
    takenCount?: number;
    freeTokens?: number[];
  }>;
  /** Minutes per patient behind the queue's projection; null until a snapshot exists. */
  consultationMinutes: number | null;
}

export interface ReceptionLiveQueueBoard {
  clinicId: string;
  /** The IST day this board describes. */
  date: string;
  generatedAt: string;
  doctors: DoctorLiveQueue[];
}
