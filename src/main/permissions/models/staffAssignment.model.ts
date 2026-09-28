import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

export const staffAccessScopeEnum = pgEnum('staff_access_scope', [
  'assigned_doctors',
  'all_doctors',
]);

// Kept off `clinic_assign` because that table is shared by every role — a
// doctor row has no business carrying an access scope. Role-neutral by design:
// a receptionist, nurse or manager all answer the same question here, so the
// role list lives in SCOPED_STAFF_ROLES rather than in the schema.
export const StaffScopeModel = pgTable(
  'staff_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    accessScope: staffAccessScopeEnum('access_scope')
      .default('assigned_doctors')
      .notNull(),
    location: varchar('location', { length: 120 }),
    responsibility: varchar('responsibility', { length: 255 }),
    updatedBy: uuid('updated_by').references(() => UserModel.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('staff_scopes_user_clinic_unique').on(
      table.userId,
      table.clinicId
    ),
  ]
);

// A relation rather than an array column on the scope row, so the reverse
// question — who is responsible for Doctor 1? — stays an indexed lookup.
export const StaffDoctorAssignmentModel = pgTable(
  'staff_doctor_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffUserId: uuid('staff_user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    doctorUserId: uuid('doctor_user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    assignedBy: uuid('assigned_by').references(() => UserModel.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('staff_doctor_assignment_unique').on(
      table.staffUserId,
      table.clinicId,
      table.doctorUserId
    ),
    index('idx_staff_doctor_by_doctor').on(table.clinicId, table.doctorUserId),
  ]
);
