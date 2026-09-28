import {
  pgTable,
  pgEnum,
  uuid,
  date,
  timestamp,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

/** Who caused the arrival to be recorded: self, reception, or the auto-mark-on-confirm fallback. */
export const doctorArrivalSourceEnum = pgEnum('doctor_arrival_source', [
  'self',
  'reception',
  'auto_confirm',
]);

/** Append-only record of when a doctor started a shift, scoped to (doctorId, forDate, sessionStart) so a two-shift doctor arrives for each independently. */
export const DoctorArrivalModel = pgTable(
  'doctor_arrivals',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),

    doctorId: uuid('doctor_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),

    /** IST calendar day, always today. */
    forDate: date('for_date').notNull(),

    /** IST 'HH:mm' of the shift; null on a single-session day. */
    sessionStart: varchar('session_start'),

    /** Actual wall-clock instant the doctor arrived. */
    arrivedAt: timestamp('arrived_at').notNull(),

    source: doctorArrivalSourceEnum('source').notNull(),

    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('doctor_arrivals_lookup_idx').on(
      table.doctorId,
      table.forDate,
      table.sessionStart,
      table.createdAt
    ),
    index('doctor_arrivals_clinic_date_idx').on(table.clinicId, table.forDate),
  ]
);

export type DoctorArrival = typeof DoctorArrivalModel.$inferSelect;
export type NewDoctorArrival = typeof DoctorArrivalModel.$inferInsert;
