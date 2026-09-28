export const APPOINTMENT_TYPE_CONSULTATION = 'Consultation';

/** Override: no reason given beyond "the schedule did not offer this". */
export const APPOINTMENT_TYPE_CUSTOM = 'Custom';
/** Override: urgent, which is the case the whole flow exists for. */
export const APPOINTMENT_TYPE_EMERGENCY = 'Emergency';
/** Override: a return visit squeezed in outside the doctor's normal slots. */
export const APPOINTMENT_TYPE_FOLLOW_UP = 'Follow-up';

export const OVERRIDE_APPOINTMENT_TYPES = [
  APPOINTMENT_TYPE_CUSTOM,
  APPOINTMENT_TYPE_EMERGENCY,
  APPOINTMENT_TYPE_FOLLOW_UP,
] as const;

export type OverrideAppointmentType =
  (typeof OVERRIDE_APPOINTMENT_TYPES)[number];

const OVERRIDE_TYPES_LOWER = new Set<string>(
  OVERRIDE_APPOINTMENT_TYPES.map((t) => t.toLowerCase())
);

/** Whether an appointment was booked through the custom / override flow. */
export const isOverrideAppointmentType = (
  appointmentType?: string | null
): boolean =>
  !!appointmentType && OVERRIDE_TYPES_LOWER.has(appointmentType.toLowerCase());
