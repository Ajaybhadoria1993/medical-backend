export type SlotStatus =
  'available' | 'break' | 'Confirmed' | 'booked' | 'reserved';
export type TokenStatus = 'available' | 'booked' | 'reserved';

export interface SlotToken {
  tokenNo: number;
  status: TokenStatus;
  appointmentId?: string;
  appointmentStatus?: string;
  patientId?: string;
  /** Custom / Emergency / Follow-up when an override booked or added it. */
  appointmentType?: string;
  /** Added beyond the session's configured capacity. */
  isExtra?: boolean;
  /** Free again after a cancellation or no-show; the number was already issued. */
  isReopened?: boolean;
}

/** One bookable window of a doctor's day; token mode fills the token fields instead of a time. */
export interface Slot {
  /** IST, `YYYY-MM-DDTHH:mm:00`. */
  start: string;
  end: string;
  clinicAvailabilityId: string;
  source: 'availability' | 'break' | 'appointment';
  status?: SlotStatus;
  breakId?: string;
  breakType?: string;
  appointmentId?: string;
  appointmentStatus?: string;
  patientId?: string;
  totalTokens?: number;
  availableTokens?: number;
  sessionIndex?: number;
  /** The shift's window, IST `HH:mm`, for labelling the choice. */
  sessionStart?: string;
  sessionEnd?: string;
  /** 1 means there is no shift to choose. */
  totalSessions?: number;
  tokens?: SlotToken[];
}
