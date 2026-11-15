// src/main/users/models/refreshToken.model.ts
//
// One row per logged-in device; a user can hold many sessions at once. See TokenService.
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';

export const RefreshTokenModel = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => UserModel.id),
    platform: varchar('platform', { length: 20 }).notNull().default('web'),
    tokenHash: varchar('token_hash', { length: 200 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    userAgent: varchar('user_agent', { length: 500 }),
    ipAddress: varchar('ip_address', { length: 100 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_refresh_token_user_platform').on(table.userId, table.platform),
    uniqueIndex('unique_refresh_token_hash').on(table.tokenHash),
  ]
);
