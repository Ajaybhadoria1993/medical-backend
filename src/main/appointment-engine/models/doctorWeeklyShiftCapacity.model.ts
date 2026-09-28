import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/**
 * DoctorWeeklyShiftCapacityModel
 *
 * A doctor's standing token capacity for one shift of one weekday — "every
 * Monday, 20 tokens in the morning clinic and 30 in the evening".
 *
 * Why this is a table rather than a column
 * ----------------------------------------
 * `clinic_availability` holds exactly one row per doctor per weekday
 * (`ux_clinic_day`), and its `noOfPatients` is therefore a single number for
 * the whole day. A split-shift day is not stored as two rows: it is one window
 * with break rows carved out of it, and the shifts are re-derived by
 * subtracting the breaks. A break row describes a *gap*, so there is nowhere
 * on it to record how many patients the shift after it holds.
 *
 * Widening `ux_clinic_day` to allow a row per shift was the alternative, and it
 * is the more invasive one by far: twenty call sites read that table, nine of
 * them destructuring a single row, and every one would silently pick an
 * arbitrary shift the moment a second row existed.
 *
 * Why `sessionIndex` and not a start time
 * ---------------------------------------
 * The same reason `appointments.sessionIndex` is an ordinal:
 * ScheduleShiftService rewrites a shift's start time when the doctor runs
 * late, so a stored 'HH:mm' would stop matching the shift it describes part
 * way through the day. The ordinal survives the block moving.
 */
export const DoctorWeeklyShiftCapacityModel = pgTable(
  'doctor_weekly_shift_capacity',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),

    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * Weekday name, matching `clinic_availability.day_of_week`. Stored as
     * written and compared case-insensitively, because that column is a free
     * varchar holding rows in both casings.
     */
    dayOfWeek: varchar('day_of_week').notNull(),

    /** Which shift of that day, 1-based: 1 = first, 2 = second. */
    sessionIndex: integer('session_index').notNull(),

    /** Tokens this shift holds. Numbering restarts at 1 in each shift. */
    noOfPatients: integer('no_of_patients').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // One capacity per shift per weekday, so an upsert can target it.
    uniqueIndex('ux_weekly_shift_capacity').on(
      table.clinicId,
      table.doctorId,
      table.dayOfWeek,
      table.sessionIndex
    ),
  ]
);

export type DoctorWeeklyShiftCapacity =
  typeof DoctorWeeklyShiftCapacityModel.$inferSelect;
export type NewDoctorWeeklyShiftCapacity =
  typeof DoctorWeeklyShiftCapacityModel.$inferInsert;
