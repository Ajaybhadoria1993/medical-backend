// src/models/token.model.ts
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';
import { uniqueIndex } from 'drizzle-orm/pg-core';

export const tokenTypeEnum = pgEnum('token_type', [
  'email_verification',
  'password_reset',
  'registration_verification',
  'registration_session',
  'set_initial_password',
  // patient_otp: OTP-based mobile login for patients.
  // The `email` column stores the patient's mobile number for this type.
  // The `userId` column is NULL until after successful verification.
  'patient_otp',
]);

export const TokenModel = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => UserModel.id),
    // For patient_otp type: stores the patient's mobile number (not an email)
    email: varchar('email', { length: 255 }),
    tokenHash: varchar('token_hash', { length: 200 }).notNull(),
    type: tokenTypeEnum('type').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    used: boolean('used').default(false).notNull(),
    // For patient_otp type: tracks resend count to enforce max-resend cap
    resendCount: integer('resend_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_token_hash').on(
      table.userId,
      table.tokenHash,
      table.type
    ),
    uniqueIndex('unique_registration_token').on(
      table.email,
      table.tokenHash,
      table.type
    ),
    // Fast lookup for patient OTP by mobile (stored in email column)
    index('tokens_patient_otp_mobile_idx').on(table.email, table.type),
  ]
);
