import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { AppointmentModel } from './appointment.model';

export const appointmentActivityActionEnum = pgEnum(
  'appointment_activity_action',
  [
    'CREATED',
    'UPDATED',
    'CONFIRMED',
    'COMPLETED',
    'STATUS_CHANGED',
    'PAYMENT_STATUS',
    'VITALS_UPDATED',
    'RESCHEDULED',
    'PATIENT_ARRIVED',
    'CANCELLED',
    'NOTES_ADDED',
    'REMINDER_SENT',
    'TEST_PRESCRIBED',
    'PRESCRIPTION_CREATED',
    'PRESCRIPTION_UPDATED',
    'TEST_REPORT_UPLOADED',
    // Desk follow-up on a doctor-set follow-up date; newState carries reportCardId (+ outcome, nextCallDate).
    'FOLLOW_UP_CALL',
    'FOLLOW_UP_DISMISSED',
  ]
);

export const AppointmentActivityHistoryModel = pgTable(
  'appointment_activity_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    action: appointmentActivityActionEnum('action').notNull(),
    performedBy: uuid('performed_by').references(() => UserModel.id),
    previousState: jsonb('previous_state'),
    newState: jsonb('new_state'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  // Follow-ups list: FOLLOW_UP_* rows by action alone and per visit; action first serves both.
  (table) => [
    index('appointment_activity_history_action_appt_idx').on(
      table.action,
      table.appointmentId
    ),
  ]
);
