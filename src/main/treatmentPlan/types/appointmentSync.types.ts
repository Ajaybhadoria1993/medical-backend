export type AppointmentChangeKind =
  'completed' | 'no_show' | 'cancelled' | 'rescheduled';

/** Sent by the appointments side after commit (DEV_PLAN §7). */
export interface AppointmentChangedEvent {
  appointmentId: string;
  clinicId: string;
  kind: AppointmentChangeKind;
  /** IST day, YYYY-MM-DD. */
  date: string;
}
