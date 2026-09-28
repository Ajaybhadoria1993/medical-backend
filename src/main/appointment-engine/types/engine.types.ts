/**
 * Appointment Engine - Core Interfaces and Types
 *
 * Defines all service interfaces and shared types for the real-time
 * appointment flow management engine.
 */

// ─── Appointment Status ──────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'Upcoming'
  | 'Confirmed'
  | 'Patient Arrived'
  | 'In Consultation'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow';

/**
 * Engine-only: "in the room right now", stamped from the Redis
 * `currentAppointmentId` pointer and never written to the database. Splits the
 * two meanings `Confirmed` used to carry, which made an ordinary confirmed
 * booking report as in-consultation with zero wait.
 */
export const IN_CONSULTATION: AppointmentStatus = 'In Consultation';

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface AppointmentRecord {
  id: string;
  appointmentDate: Date;
  appointmentTime: string | null;
  tokenNo: number | null;
  appointmentStatus: AppointmentStatus;
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentDurationMinutes: string | null;
  userId: string;
}

export interface QueueDelayData {
  clinicId: string;
  doctorId: string;
  date: string;
  cumulativeDelayMinutes: number;
  lastCalculatedAt: string;
  appointments: AppointmentDelayEntry[];
  /**
   * Which source produced the consultation length behind this projection —
   * `learned` | `configured` | `slot` | `default`. Carried on the queue data
   * (and therefore through the Redis cache) so every consumer reports the same
   * basis without re-deriving it. Optional: cache entries written before this
   * field existed simply lack it.
   */
  consultationBasis?: string;
  /** The length that basis produced, and how many visits it was measured over. */
  consultationMinutes?: number | null;
  consultationSampleSize?: number;
}

export interface AppointmentDelayEntry {
  appointmentId: string;
  patientId: string;
  userId: string;
  status: AppointmentStatus;
  scheduledTime: string | null;
  tokenNo: number | null;
  /**
   * Which shift this appointment belongs to, 1-based. Null/absent for a
   * time-based appointment, a token appointment booked before shift-wise
   * numbering existed, or a cache entry written before this field existed —
   * all read as a single, undivided queue for the day, exactly as
   * sessionIndex-aware code elsewhere treats a null session. Optional for the
   * same reason `isOnHold` is: a pre-existing Redis cache entry lacks it.
   */
  sessionIndex?: number | null;
  projectedStartTime: string;
  /**
   * True when the projection has run past the end of this appointment's own
   * shift — the patient was not seen while their session was open, and the
   * minutes the queue would now need belong to the next shift's own tokens.
   *
   * `projectedStartTime` is still populated: a client needs something to
   * show, and it remains the best available answer to "when would this have
   * been seen". This flag says not to present it as a live estimate — the row
   * reads as missed, with the time behind it as context. Absent/false means
   * an ordinary live projection. Only ever set for a sessioned appointment; a
   * sessionless day is one continuous queue with no boundary to cross.
   */
  isMissedSession?: boolean;
  estimatedWaitMinutes: number;
  durationMinutes: number;
  /**
   * True while a receptionist/doctor has paused this appointment via the live
   * queue (Hold or Skip) — see queueHoldStore.service. A held appointment is
   * excluded from the projected-start cascade (it doesn't push everyone
   * behind it later, since it isn't going to be seen next) and carries no
   * live wait projection of its own. Optional: cache entries written before
   * this field existed simply lack it — treat missing as false.
   */
  isOnHold?: boolean;
  /** Only meaningful when isOnHold is true. */
  holdReason?: 'held' | 'skipped';
  /** ISO timestamp the doctor put this patient in the room; only set on the entry currently being seen. */
  startedAt?: string | null;
  /** ISO timestamp the patient checked in — set once, the first time the appointment reaches "Patient Arrived". Null if not yet arrived. */
  arrivedAt?: string | null;
}

export interface ShiftResult {
  shiftedAppointments: Array<{
    appointmentId: string;
    patientId: string;
    userId: string;
    oldTime: string;
    newTime: string;
  }>;
}
