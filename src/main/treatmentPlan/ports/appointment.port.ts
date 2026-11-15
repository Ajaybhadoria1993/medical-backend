import type { CoveredVisit } from '../types/plan.types';
/** An appointment as plan screens show it; date is the IST day (YYYY-MM-DD). */
export interface PlanAppointment {
  id: string;
  patientId: string;
  doctorId: string | null;
  date: string;
  time: string | null;
  tokenNo: number | null;
  status: string;
  /** Booked from a plan (type "treatment", ₹0 at the desk), as opposed to a normal paid visit. */
  isPlanVisit: boolean;
}

/** One way to book a day: an open time, or a token session with numbers left (the next one is issued). */
export interface BookingOption {
  time: string | null;
  sessionIndex: number | null;
  /** Token clinics: the exact free number; null for a timed slot. */
  tokenNo: number | null;
  label: string;
  /** Token clinics: the session it belongs to, e.g. "09:00–13:00", so the screen can group them. */
  group: string | null;
}

/** What the module reads about appointments, and the one way it creates them: through the
 *  appointments module's own booking, so every rule there still applies (DEV_PLAN §2, 4.2). */
export interface AppointmentPort {
  /** The appointment if it belongs to the clinic, else null. */
  getAppointment(
    clinicId: string,
    appointmentId: string
  ): Promise<PlanAppointment | null>;
  /** Several at once, by id; ids not in the clinic are left out. */
  getAppointments(
    clinicId: string,
    appointmentIds: string[]
  ): Promise<Map<string, PlanAppointment>>;
  /** The doctor's free times (or token sessions) on one day. */
  bookingOptions(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<{
    mode: 'slot' | 'token';
    options: BookingOption[];
    /** The doctor works that weekday but no token count is saved for it. */
    tokensNotSet?: boolean;
  }>;
  /** Books a "Treatment" visit with no fee taken at the desk; throws the booking's own errors. */
  bookTreatmentVisit(
    clinicId: string,
    actorId: string,
    input: {
      patientId: string;
      doctorId: string;
      date: string;
      time: string | null;
      sessionIndex: number | null;
      tokenNo: number | null;
      notes: string;
    }
  ): Promise<PlanAppointment>;
  /** The patient's still-open appointments with this doctor from `fromDate` on. */
  /** Cancels a visit the plan booked, through the clinic's normal cancellation flow. */
  cancelPlanVisit(
    clinicId: string,
    appointmentId: string,
    actorId: string,
    actorRole: string
  ): Promise<void>;
  /** Who cancelled the visit and the reason they gave; null when no cancellation was recorded. */
  cancellationOf(
    appointmentId: string
  ): Promise<{ actorId: string | null; reason: string | null } | null>;
  /** Net money received on a normal visit, in paise (0 for a plan visit, which is not billed). */
  receivedOnVisitPaise(appointmentId: string): Promise<number>;
  /** In the caller's transaction: the plan now pays for this normal visit (its own charge goes).
   *  Returns what it was, or null if it is a plan visit already or money was taken on it. */
  coverVisit(
    tx: unknown,
    appointmentId: string,
    actorId: string
  ): Promise<CoveredVisit | null>;
  /** In the caller's transaction: gives a covered visit back its own price and payment mode. */
  uncoverVisit(
    tx: unknown,
    appointmentId: string,
    actorId: string,
    was: CoveredVisit
  ): Promise<void>;
  /** The patient's visit today with this doctor that did happen or is happening (not cancelled/missed). */
  todayForPatient(
    clinicId: string,
    patientId: string,
    doctorId: string,
    today: string
  ): Promise<PlanAppointment | null>;
  upcomingForPatient(
    clinicId: string,
    patientId: string,
    doctorId: string,
    fromDate: string
  ): Promise<PlanAppointment[]>;
}
