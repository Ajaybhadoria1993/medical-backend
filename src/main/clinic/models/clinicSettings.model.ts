import {
  pgTable,
  pgEnum,
  uuid,
  boolean,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from './clinic.model';

/**
 * How a clinic treats a patient who arrives after their grace period.
 *
 * `keep_position` reproduces the behaviour before late handling existed: the
 * late patient slots straight back in where they were booked.
 */
export const latePatientPolicyEnum = pgEnum('late_patient_policy', [
  'keep_position',
  'move_back',
  'move_to_end',
]);

export const ClinicSettingsModel = pgTable('clinic_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  clinicId: uuid('clinic_id')
    .references(() => ClinicModel.id)
    .notNull()
    .unique(),

  voiceCallEnabled: boolean('voice_call_enabled').default(false).notNull(),

  smsEnabled: boolean('sms_enabled').default(false).notNull(),

  whatsappEnabled: boolean('whatsapp_enabled').default(false).notNull(),

  loginAlertsEnabled: boolean('login_alerts_enabled').default(false).notNull(),

  autoLogoutMinutes: integer('auto_logout_minutes'),

  runningLateThresholdMinutes: integer(
    'running_late_threshold_minutes'
  ).default(10),

  /**
   * Fallback consultation length used when this clinic's doctors have too few
   * completed consultations to learn a real average from. Sits between the
   * learned value and the availability slot size in the resolution chain — see
   * ConsultationDurationService.
   */
  defaultConsultationMinutes: integer('default_consultation_minutes'),

  /**
   * What happens to a patient who checks in after their slot, once the
   * no-show policy's grace period has already passed. Lateness is measured
   * against `no_show_policies.gracePeriodMinutes` rather than a second
   * threshold here — two independent definitions of "late" would drift.
   */
  latePatientPolicy: latePatientPolicyEnum('late_patient_policy')
    .default('move_back')
    .notNull(),

  /** Positions to move a late patient back, for the `move_back` policy. */
  latePatientMovePositions: integer('late_patient_move_positions')
    .default(2)
    .notNull(),

  onlineBookingEnabled: boolean('online_booking_enabled')
    .default(true)
    .notNull(),

  payOnlineEnabled: boolean('pay_online_enabled').default(false).notNull(),

  payAtClinicEnabled: boolean('pay_at_clinic_enabled').default(false).notNull(),

  showClinicNumberPublicly: boolean('show_clinic_number_publicly')
    .default(true)
    .notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),

  updatedAt: timestamp('updated_at').defaultNow(),
});
