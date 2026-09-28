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
 * MFA configuration table — stores encrypted TOTP secrets and MFA state.
 * One-to-one relationship with users (unique constraint on userId).
 * Cascade-deletes when the parent user is removed.
 */
export const UserMfaModel = pgTable(
  'user_mfa',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => UserModel.id, { onDelete: 'cascade' }),
    encryptedSecret: varchar('encrypted_secret', { length: 512 }).notNull(),
    isActive: boolean('is_active').default(false).notNull(),
    isPending: boolean('is_pending').default(true).notNull(),
    enabledAt: timestamp('enabled_at'),
    lastModifiedAt: timestamp('last_modified_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('user_mfa_user_id_idx').on(table.userId),
  })
);
