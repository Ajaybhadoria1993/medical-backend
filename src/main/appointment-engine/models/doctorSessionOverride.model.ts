import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  varchar,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/**
 * Kind of override a staff member declared about a doctor's day.
 *
 * New engine features are new enum values reusing `valueMinutes` — they do not
 * add columns.
 *
 * - `running_late` — a soft announcement. Nothing is rewritten; the value is a
 *   floor on the engine's projection, so patients see a later estimate against
 *   their original slot.
 * - `schedule_shift` — the hard version. The doctor's remaining appointments
 *   and the day's bookable window physically move forward by `valueMinutes`,
 *   so a 09:30 appointment becomes 11:30 and the capacity behind it survives.
 *
 * The two never apply at once: announcing a shift clears `running_late` for
 * that doctor/day, because the delay is then encoded in the times themselves
 * and the projection floor would count it a second time.
 */
export const sessionOverrideTypeEnum = pgEnum('session_override_type', [
  'running_late',
  'schedule_shift',
  'slot_config',
  'extra_slots',
  'missed_dismissed',
]);

/**
 * DoctorSessionOverrideModel
 *
 * A staff-declared statement about one doctor's day that changes the queue:
 */
export const DoctorSessionOverrideModel = pgTable(
  'doctor_session_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),

    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),

    /** IST calendar day the override applies to. Today only — enforced in the service. */
    forDate: date('for_date').notNull(),

    type: sessionOverrideTypeEnum('type').notNull(),

    /** IST 'HH:mm' of the shift this override is for (null on a single-session day); for `missed_dismissed` it instead holds the dismissed slot's own start time. */
    sessionStart: varchar('session_start'),

    /** For `running_late`, the announced delay in minutes (0 = cleared); null for `slot_config`/`extra_slots`. */
    valueMinutes: integer('value_minutes'),

    /** `slot_config`/`extra_slots` only; for `extra_slots` these describe capacity appended after the session's end, not a grid replacement. */
    slotMinutes: integer('slot_minutes'),
    stepMinutes: integer('step_minutes'),
    numberOfSlots: integer('number_of_slots'),
    noOfPatients: integer('no_of_patients'),

    /** Why the capacity was added — Custom/Emergency/Follow-up. Null on rows
     *  written before this column, and on non-capacity override types. */
    appointmentType: varchar('appointment_type'),

    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // The read path is always "newest row for this doctor/day/type/session", so
    // the lookup and the ordering are served by one index.
    index('doctor_session_overrides_lookup_idx').on(
      table.doctorId,
      table.forDate,
      table.type,
      table.sessionStart,
      table.createdAt
    ),
    index('doctor_session_overrides_clinic_date_idx').on(
      table.clinicId,
      table.forDate
    ),
  ]
);

export type DoctorSessionOverride =
  typeof DoctorSessionOverrideModel.$inferSelect;
export type NewDoctorSessionOverride =
  typeof DoctorSessionOverrideModel.$inferInsert;
