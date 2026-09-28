import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

/**
 * MFA recovery codes — hashed backup codes for account recovery.
 * Each user with MFA enabled has up to 10 single-use recovery codes.
 */
export const UserMfaRecoveryCodeModel = pgTable(
  'user_mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    isUsed: boolean('is_used').default(false).notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('user_mfa_recovery_user_id_idx').on(table.userId),
  })
);
