export type CallType = 'RECEPTION' | 'NEXT_PATIENT';

export type CallStatus =
  'ringing' | 'answered' | 'busy' | 'missed' | 'cancelled';

export interface CallPerson {
  id: string;
  name: string;
}

/** What Redis stores. `missed` is never written — it is derived from `expiresAt`. */
export interface ClinicCall {
  id: string;
  clinicId: string;
  type: CallType;
  doctor: CallPerson & { profileImage: string | null };
  /** Set when the doctor picked one receptionist instead of everyone. */
  target: CallPerson | null;
  recipientIds: string[];
  declinedIds: string[];
  status: CallStatus;
  answeredBy: CallPerson | null;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
}

export type CallView = Omit<ClinicCall, 'recipientIds' | 'declinedIds'>;

export interface ActiveCallsResponse {
  /** Calls ringing for this receptionist, oldest first. */
  incoming: CallView[];
  /** This doctor's latest call, in any state. */
  myCall: CallView | null;
  /** Only when asked for: who this doctor can ring right now. */
  receptionists?: CallPerson[];
  serverTime: string;
}
