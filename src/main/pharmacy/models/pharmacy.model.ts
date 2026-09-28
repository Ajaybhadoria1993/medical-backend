import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  pgEnum,
  boolean,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';

// Pharmacy basic details, associated with a particular clinic
export const pharmacyStatusEnum = pgEnum('pharmacy_status', [
  'active',
  'deactive',
]);

export const pharmacyNoLossEnum = pgEnum('pharmacy_no_loss', ['true', 'false']);

export const PharmacyModel = pgTable(
  'pharmacies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    address: text('address').notNull(),
    contactNumber: varchar('contact_number', { length: 20 }).notNull(),
    registrationNumber: varchar('registration_number', { length: 30 }),
    gstNumber: varchar('gst_number', { length: 20 }),
    panNumber: varchar('pan_number', { length: 10 }),
    licenseNumber: varchar('license_number', { length: 30 }),
    fssaiNumber: varchar('fssai_number', { length: 20 }),
    status: pharmacyStatusEnum('status').default('active').notNull(),
    noLoss: pharmacyNoLossEnum('no_loss').default('true').notNull(),
    subscriptionNotificationReadDate: timestamp(
      'subscription_notification_read_date'
    ),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_pharmacy_name_clinic').on(t.clinicId, t.name, t.isDeleted),
  ]
);

// Many-to-many: users assigned to pharmacy within a clinic
export const PharmacyAssignModel = pgTable(
  'pharmacy_assign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => UserModel.id)
      .notNull(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    userRole: varchar('user_role', { length: 32 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [uniqueIndex('ux_pharmacy_user').on(t.userId, t.pharmacyId)]
);
