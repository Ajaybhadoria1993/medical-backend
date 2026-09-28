import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  text,
  uniqueIndex,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import {
  ClinicModel,
  ClinicServiceModel,
} from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicCancellationPolicyModel } from '../../cancellation-policy/models/cancellationPolicy.model';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userStatusEnum = pgEnum('apointment_status', [
  'Upcoming',
  'Completed',
  'Cancelled',
  'Rescheduled',
  'Pending',
  'Missed',
  'Confirmed',
  'Patient Arrived',
  'NoShow',
]);

export const noShowMarkedByEnum = pgEnum('no_show_marked_by', [
  'doctor',
  'receptionist',
  'system',
  'admin',
]);

export const bookingSourceEnum = pgEnum('booking_source', [
  'mobile_app',
  'web_portal',
  'phone_call',
  'walk_in',
  'system',
]);

export const commonSymptomsEnum = pgEnum('common_symptoms', [
  'Fever',
  'Headache',
  'Body_Pain',
  'Fatigue',
  'Weakness',
  'Loss_of_Appetite',
  'Nausea',
  'Dizziness',
  'Cough',
  'Sore_Throat',
  'Chills',
  'Sweating',
  'Sleep_Disturbance',
]);

// ─── Core Appointment Model (Scheduling & Status) ────────────────────────────

export const AppointmentModel = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentType: varchar('appointment_type').notNull(),
    appointmentDate: timestamp('appointment_date').notNull(),
    appointmentTime: varchar('appointment_time'),
    tokenNo: integer('token_no'),

    /** The doctor's running registration number for this visit (1, 2, 3… per doctor in the clinic), never reused.
     * Issued by AppointmentRegistrationService inside the booking transaction; null on rows before it existed. */
    registrationNo: integer('registration_no'),

    /**
     * Which shift of the day this token belongs to: 1 = first, 2 = second.
     *
     * A token is identified by (date, sessionIndex, tokenNo) — each shift
     * restarts its numbering at 1, so `tokenNo` alone is ambiguous on a
     * split-shift day: a doctor working 09:00-13:00 and 17:00-21:00 has two
     * token 3s, and nothing on the row said which was which.
     *
     * An ordinal rather than the shift's start time, because start times are
     * mutable: ScheduleShiftService rewrites them when a doctor runs late, so
     * a stored 'HH:mm' would orphan every token in that session mid-day. The
     * ordinal survives an order-preserving move; a shift that would reorder
     * the day's blocks is rejected rather than silently remapped.
     *
     * Null means a single-shift day, or a row predating shift-wise tokens —
     * both read as session 1.
     */
    sessionIndex: integer('session_index'),

    appointmentStatus: userStatusEnum('appointment_status')
      .default('Upcoming')
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id)
      .notNull(),
    doctorId: uuid('doctor_id').references(() => UserModel.id, {
      onDelete: 'cascade',
    }),
    clinicServiceId: uuid('clinic_service_id').references(
      () => ClinicServiceModel.id
    ),
    clinicCancellationPolicyId: uuid(
      'clinic_cancellation_policy_id'
    ).references(() => ClinicCancellationPolicyModel.id),
    appointmentDurationMinutes: varchar('appointment_duration_minutes'),
    reReasonForCancellation: text('reason_for_cancellation'),
    reasionForReSchedule: text('reason_for_reschedule'),
    /**
     * When the patient actually checked in. Set once, the first time the
     * appointment reaches "Patient Arrived". Lateness is `arrivedAt -
     * appointmentTime`, and nothing about late handling is answerable without
     * it — the activity history records that they arrived, but reading it on
     * every queue recalculation would be far too expensive.
     */
    arrivedAt: timestamp('arrived_at'),

    /**
     * How many places this appointment has been moved back for arriving late.
     * 0 (or null) means untouched.
     *
     * Stored as a count rather than by rewriting `appointmentTime`/`tokenNo`:
     * those record what the clinic actually promised, wait time is measured as
     * `projected - scheduled` against them, and overwriting them would both
     * corrupt that figure and erase the evidence that a demotion happened.
     */
    lateQueueDemotion: integer('late_queue_demotion').default(0).notNull(),

    noShowMarkedBy: noShowMarkedByEnum('no_show_marked_by'),
    bookingSource: bookingSourceEnum('booking_source')
      .default('system')
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('appointment_unique').on(
      table.clinicId,
      table.patientId,
      table.createdAt
    ),
    index('appointments_appointment_date_idx').on(table.appointmentDate),
    index('appointments_clinic_status_date_idx').on(
      table.clinicId,
      table.appointmentStatus,
      table.appointmentDate
    ),
    index('appointments_doctor_date_idx').on(
      table.doctorId,
      table.appointmentDate
    ),

    /**
     * One live token per (doctor, date, session). Token uniqueness was
     * previously enforced only by an in-memory `bookedSet` check in the
     * booking service, which two concurrent bookings can both pass.
     *
     * Partial: rows without a token (time-slot mode) are excluded entirely, so
     * this can never reject a time-based booking, and cancelled/no-show rows
     * release their number for rebooking.
     */
    uniqueIndex('ux_appt_token_per_session')
      .on(
        table.clinicId,
        table.doctorId,
        table.appointmentDate,
        table.sessionIndex,
        table.tokenNo
      )
      .where(
        sql`${table.tokenNo} IS NOT NULL AND ${table.appointmentStatus} NOT IN ('Cancelled', 'NoShow')`
      ),

    // Backs the counter: a registration number exists once per doctor in a clinic, even if something bypasses it.
    uniqueIndex('ux_appt_registration_no_per_doctor')
      .on(table.clinicId, table.doctorId, table.registrationNo)
      .where(sql`${table.registrationNo} IS NOT NULL`),
  ]
);
