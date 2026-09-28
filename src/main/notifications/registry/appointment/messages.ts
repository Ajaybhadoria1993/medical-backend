/**
 * Appointment copy — every word the appointment module can send, in one file.
 *
 * Split by audience, because one event reads differently depending on who is
 * reading it. The clinic sees who did what to whose appointment; the patient
 * sees what happened to theirs. Sending one shared string to both is how a
 * patient ends up reading staff-facing copy about themselves, and the wording
 * below preserves the distinction the previous helpers already made.
 *
 * In-app and push text is authored here and can be edited freely. SMS and
 * WhatsApp are not: SMS content is registered with Indian telecom operators
 * under DLT and WhatsApp templates are approved by Meta, so those resolve to a
 * reference plus parameters rather than a finished string. Editing their
 * wording is a re-registration, not a code change.
 *
 * Copy is kept out of events.ts on purpose: wording changes for different
 * reasons, by different people, at a different review bar than "who receives
 * this".
 */

import type { AppointmentCtx } from './recipients';

export interface AppointmentCopyCtx extends AppointmentCtx {
  patientName: string;
  doctorName: string;
  clinicName?: string;
  /** Human-readable schedule, already formatted in clinic-local time. */
  when?: string;
  performerName?: string;
  performerRole?: string;
}

const clinicOf = (p: AppointmentCopyCtx) => p.clinicName || 'the clinic';

/** Names arrive as typed, often lowercase. Notifications are read at a glance. */
export const name = (value: string) =>
  value.replace(
    /(^|[\s'-])([a-z])/g,
    (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`
  );

/** doctorName is absent when enrich fails, and 'your doctor' when unassigned —
 *  name() would crash on one and print "Your Doctor" for the other. */
export const doctorOf = (p: { doctorName?: string }) =>
  p.doctorName && p.doctorName !== 'your doctor'
    ? name(p.doctorName)
    : 'your doctor';

/** Falls back to a plain phrasing when the performer is a cron job, not a person. */
const by = (p: AppointmentCopyCtx) =>
  p.performerName
    ? `${p.performerName}${p.performerRole ? ` (${p.performerRole})` : ''}`
    : 'The clinic';

export const appointmentMessages = {
  staff: {
    created: (p: AppointmentCopyCtx) => ({
      title: `New appointment – ${name(p.patientName)}`,
      body: p.when
        ? `${p.when} with ${name(p.doctorName)}. Booked by ${by(p)}.`
        : `Booked by ${by(p)}. No time set yet.`,
    }),
    rescheduled: (p: AppointmentCopyCtx) => ({
      title: `Rescheduled – ${name(p.patientName)}`,
      body: p.when
        ? `Moved to ${p.when} with ${name(p.doctorName)}, by ${by(p)}.`
        : `Moved by ${by(p)}. The new time is not set yet.`,
    }),
    confirmed: (p: AppointmentCopyCtx) => ({
      title: `Confirmed – ${name(p.patientName)}`,
      body: p.when
        ? `${p.when} with ${name(p.doctorName)}, confirmed by ${by(p)}.`
        : `Confirmed by ${by(p)}.`,
    }),
    cancelled: (p: AppointmentCopyCtx) => ({
      title: `Cancelled – ${name(p.patientName)}`,
      body: p.when
        ? `${p.when} cancelled by ${by(p)}. The slot is free again.`
        : `Cancelled by ${by(p)}. The slot is free again.`,
    }),
    noShow: (p: AppointmentCopyCtx) => ({
      title: `No show – ${name(p.patientName)}`,
      body: p.when
        ? `${name(p.patientName)} did not arrive for ${p.when}.`
        : `${name(p.patientName)} did not arrive.`,
    }),
  },

  /** Doubles as the push: titles stand alone on a lock screen, and bodies name
   *  when/doctor/clinic so a patient with two bookings knows which changed. */
  patient: {
    created: (p: AppointmentCopyCtx) => ({
      title: `Appointment booked with ${doctorOf(p)}`,
      body: p.when
        ? `${p.when} at ${clinicOf(p)}. Tap to view details.`
        : `At ${clinicOf(p)}. We will confirm the time shortly.`,
    }),
    rescheduled: (p: AppointmentCopyCtx) => ({
      title: 'Appointment rescheduled',
      body: p.when
        ? `New time: ${p.when} with ${doctorOf(p)} at ${clinicOf(p)}.`
        : `Your appointment with ${doctorOf(p)} at ${clinicOf(p)} was moved. We will confirm the new time shortly.`,
    }),
    confirmed: (p: AppointmentCopyCtx) => ({
      title: 'Appointment confirmed',
      body: p.when
        ? `${p.when} with ${doctorOf(p)} at ${clinicOf(p)}. Please arrive 10 minutes early.`
        : `With ${doctorOf(p)} at ${clinicOf(p)}. Please arrive 10 minutes early.`,
    }),
    cancelled: (p: AppointmentCopyCtx) => ({
      title: 'Appointment cancelled',
      body: p.when
        ? `Your appointment on ${p.when} with ${doctorOf(p)} at ${clinicOf(p)} was cancelled. Tap to book a new time.`
        : `Your appointment with ${doctorOf(p)} at ${clinicOf(p)} was cancelled. Tap to book a new time.`,
    }),
  },
};
