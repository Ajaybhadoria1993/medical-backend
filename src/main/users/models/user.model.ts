import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userTypeEnum = pgEnum('user_type', [
  'Admin',
  'User',
  'Super_Admin',
  'Doctor',
  'Receptionist',
  'Nurse',
  'Patient',
  'Pharmacist',
  'Lab_Assistant',
  'Radiologist',
]);

export const userStatusEnum = pgEnum('user_status', [
  'Active',
  'Inactive',
  'Blocked',
  'New',
  'Pending',
  'Reviewing',
  'Rejected',
]);

/**
 * Core user table — authentication & identity only.
 * Personal details live in `user_profiles`, professional info in `user_professionals`.
 *
 * Identity rules:
 *  - email: NULLABLE. Staff must have a unique email; patients don't need one.
 *  - mobile: NULLABLE. Patients use mobile for OTP login; family members may have NULL.
 *  - Partial unique index on email for non-Patient users only.
 *  - Partial unique index on mobile for Patient users only (one mobile = one patient).
 */
export const UserModel = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }),
    userName: varchar('user_name', { length: 15 }).unique(),
    // Nullable — patients don't require an email address
    email: varchar('email'),
    mobile: varchar('mobile'),
    password: varchar('password'),
    socialProvider: varchar('social_provider', { length: 40 }),
    socialProviderId: varchar('social_provider_id', { length: 255 }),
    userType: userTypeEnum('user_type').notNull(),
    userStatus: userStatusEnum('user_status').default('Active').notNull(),
    emailVerifiedAt: timestamp('email_verified_at'),
    isUserBlocked: boolean('is_user_blocked').default(false),
    isAdminDoctorAccess: boolean('is_admin_doctor_access')
      .default(false)
      .notNull(),
    isArchive: boolean('is_archive').default(false).notNull(),
    paymentVisible: boolean('payment_visible').default(true),
    passwordChangedAt: timestamp('password_changed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Fast lookup for staff login by email
    emailIdx: index('email_idx').on(table.email),
    userNameIdx: index('user_name_idx').on(table.userName),
    // Fast lookup for patient OTP login by mobile
    mobileIdx: index('mobile_idx').on(table.mobile),
    // Social login uniqueness
    socialProviderIdx: uniqueIndex('ux_users_social_provider_id').on(
      table.socialProvider,
      table.socialProviderId
    ),
    // Staff email must be unique (non-Patient, non-null)
    staffEmailUniqueIdx: uniqueIndex('ux_staff_email')
      .on(table.email)
      .where(sql`user_type != 'Patient' AND email IS NOT NULL`),
    // One mobile number = one patient identity
    patientMobileUniqueIdx: uniqueIndex('ux_patient_mobile')
      .on(table.mobile)
      .where(sql`user_type = 'Patient' AND mobile IS NOT NULL`),
  })
);
