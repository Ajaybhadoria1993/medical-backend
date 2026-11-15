// ─── Appointment Status ──────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'Upcoming'
  | 'Confirmed'
  | 'Patient Arrived'
  | 'In Consultation'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow';

/** Engine-only "in the room now", from the Redis room pointer; never stored, unlike `Confirmed`. */
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
  /** Source of the consultation length (`learned` | `configured` | `slot` | `default`), so all consumers agree. */
  consultationBasis?: string;
  /** The length that basis produced, and how many visits it was measured over. */
  consultationMinutes?: number | null;
  consultationSampleSize?: number;
  /** Doctor marked arrived for the current shift; absent on old cache entries, read as arrived. */
  doctorArrived?: boolean;
}

export interface AppointmentDelayEntry {
  appointmentId: string;
  patientId: string;
  userId: string;
  status: AppointmentStatus;
  scheduledTime: string | null;
  tokenNo: number | null;
  /** 1-based shift; null/absent (time-based day, older bookings or cache) reads as one queue for the day. */
  sessionIndex?: number | null;
  projectedStartTime: string;
  /** Projection ran past this patient's own shift end; `projectedStartTime` is context, not a live estimate. */
  isMissedSession?: boolean;
  /** Doctor arrived for this patient's own shift or sitting; absent means use the queue's `doctorArrived`. */
  doctorArrived?: boolean;
  estimatedWaitMinutes: number;
  durationMinutes: number;
  /** Held or skipped on the live queue: out of the projection cascade, no wait of its own; missing = false. */
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
