import type { z } from 'zod';
import type { followUpKindValues } from '../schemas/followUp.schemas';

export type FollowUpKind = z.infer<typeof followUpKindValues>;

export interface FollowUpCall {
  outcome: string | null;
  notes: string | null;
  /** IST day, YYYY-MM-DD. */
  nextCallDate: string | null;
  at: Date;
  byName: string | null;
}

export interface FollowUpItem {
  /** Stable row key: kind plus refId. */
  id: string;
  kind: FollowUpKind;
  /** Report card for doctor follow-ups, step for plan steps, plan for call-backs and check-ups. */
  refId: string;
  /** IST day, YYYY-MM-DD; a doctor follow-up's "call again on" date replaces the prescribed one. */
  dueDate: string;
  due: 'overdue' | 'today' | 'upcoming';
  patient: PatientContact & {
    id: string;
    /** IST day of the latest completed visit at this clinic. */
    lastVisit: string | null;
  };
  doctor: { id: string; name: string | null };
  /** The visit the doctor set the follow-up on; null for plan rows. */
  sourceAppointmentId: string | null;
  plan: {
    id: string;
    title: string;
    stepId: string | null;
    stepName: string | null;
    stepSeq: number | null;
    stepStatus: string | null;
    stepCount: number | null;
    status: string;
  } | null;
  lastCall: FollowUpCall | null;
  callCount: number;
  /** Set when a visit row is due today or later on a day the doctor is on leave or off. */
  doctorDay: 'leave' | 'off' | null;
}

export interface FollowUpList {
  items: FollowUpItem[];
  /** Counts ignore the `due` filter so the cards stay usable as filters. */
  summary: { overdue: number; today: number; upcoming: number };
  range: { from: string; to: string };
  pagination: { pageNumber: number; pageSize: number; total: number };
}

export type RawCall = Omit<FollowUpCall, 'byName'> & { actorId: string | null };
export interface PatientContact {
  name: string | null;
  mobile: string | null;
  alternateMobile: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
}

export type People = Map<string, PatientContact>;

/** A doctor's day per the schedule; a past day is never offered. */
export type DoctorDayStatus = 'ok' | 'leave' | 'off' | 'past';
/** What the schedule cache holds; "past" depends on today, so it is never stored. */
export type ScheduleDayStatus = Exclude<DoctorDayStatus, 'past'>;

export interface DoctorDay {
  /** IST day, YYYY-MM-DD. */
  date: string;
  status: DoctorDayStatus;
}

export interface FollowUpDateCheck {
  date: string;
  /** inactive: the doctor's account is not active. */
  status: DoctorDayStatus | 'inactive';
  /** The first working day within 30 days; null when the picked day is fine or none is found. */
  nextGoodDay: string | null;
  /** The patient's earliest waiting visit with this doctor after today. */
  patientBooking: { appointmentId: string; date: string } | null;
}
