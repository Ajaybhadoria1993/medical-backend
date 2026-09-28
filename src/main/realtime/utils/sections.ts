/**
 * Sections — the entire contract between backend and frontend.
 *
 * A "section" names a slice of state a screen can be looking at. The bus
 * never sends the state itself, only "section X changed, this is version N";
 * the client then refetches that section's one REST snapshot.
 *
 * Each section is paired with the room its signal is emitted to. The pairing
 * lives here (rather than being derived from the section string) because the
 * room is not always recoverable from the section id — an appointment signal
 * is addressed to the *patient's* private room, and the patient id is not
 * part of the appointment section.
 */

import { rooms } from './rooms';
import type { RealtimeTarget } from '../interfaces';

export const target = {
  /**
   * One doctor's queue for one day.
   * Snapshot: GET /api/v1/appointments/queue-state
   */
  queue: (
    clinicId: string,
    doctorId: string,
    date: string
  ): RealtimeTarget => ({
    section: `queue:${clinicId}:${doctorId}:${date}`,
    room: rooms.clinicDoctor(clinicId, doctorId),
  }),

  /**
   * The clinic-wide reception board (every doctor's queue at a glance).
   * Snapshot: GET /api/v1/appointments/reception/live-queue
   */
  board: (clinicId: string): RealtimeTarget => ({
    section: `board:${clinicId}`,
    room: rooms.clinic(clinicId),
  }),

  /**
   * One patient's own view of their appointment. Addressed to the patient,
   * not the clinic — this is the only target that leaves clinic staff.
   */
  appointment: (appointmentId: string, patientId: string): RealtimeTarget => ({
    section: `appointment:${appointmentId}`,
    room: rooms.user(patientId),
  }),

  /**
   * One open clinical encounter (an appointment's vitals/notes as the doctor
   * is editing it). Distinct from `appointment`, which is addressed to the
   * patient's room only — no staff socket is in it, so a clinical-fields-only
   * edit could never reach a doctor's own open patient screen without this.
   * Snapshot: GET /api/v1/appointments/:id (clinical fields).
   */
  encounter: (
    clinicId: string,
    doctorId: string,
    appointmentId: string
  ): RealtimeTarget => ({
    section: `encounter:${appointmentId}`,
    room: rooms.clinicDoctor(clinicId, doctorId),
  }),

  /**
   * Clinic-wide billing/payment status. Broad like `board`, not narrowed to
   * one doctor — reception, admin and (eventually) a billing screen all need
   * to see the same payment state regardless of which doctor an appointment
   * belongs to.
   * Snapshot: whichever payment/billing list endpoint the screen already uses.
   */
  billing: (clinicId: string): RealtimeTarget => ({
    section: `billing:${clinicId}`,
    room: rooms.clinic(clinicId),
  }),

  /**
   * One lab's worklist (orders, sample status, results).
   * Snapshot: whichever lab worklist endpoint the screen already uses.
   */
  lab: (labId: string): RealtimeTarget => ({
    section: `lab:${labId}`,
    room: rooms.lab(labId),
  }),

  /**
   * Clinic-wide staff status (a staff member's approval/active/suspended
   * state). Broad like `board`/`billing` — the staff directory and any
   * presence indicator need to see the same state regardless of role.
   * Snapshot: whichever staff-list endpoint the screen already uses.
   */
  staff: (clinicId: string): RealtimeTarget => ({
    section: `staff:${clinicId}`,
    room: rooms.clinic(clinicId),
  }),

  /**
   * One staff member's own effective permissions. Addressed to that user,
   * like `appointment` — an admin's edit must reach the *target's* session,
   * not the clinic at large, and no one else has any business refetching it.
   * Snapshot: GET /api/v1/permissions/me.
   */
  permissions: (userId: string): RealtimeTarget => ({
    section: `permissions:${userId}`,
    room: rooms.user(userId),
  }),

  /**
   * Doctor→reception calls. Clinic-wide: doctor rooms are fixed at connect and miss newly added doctors.
   * Snapshot: GET /api/v1/calls/active
   */
  calls: (clinicId: string): RealtimeTarget => ({
    section: `calls:${clinicId}`,
    room: rooms.clinic(clinicId),
  }),

  /**
   * One user's active session / authentication state (e.g. password changed or reset).
   * Addressed to that user's private room.
   */
  session: (userId: string): RealtimeTarget => ({
    section: `session:${userId}`,
    room: rooms.user(userId),
  }),
};
