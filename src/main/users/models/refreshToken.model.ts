// src/main/users/models/refreshToken.model.ts
//
// One row per (user, platform) — enforced by the unique index below. Every
// login/refresh on a given platform replaces that platform's row rather than
// adding a new one, so the table never accumulates historical/stale sessions,
// but a user can hold one web session AND one app session (ios/android)
// simultaneously without either kicking the other out. See TokenService.
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
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
    uniqueIndex('unique_refresh_token_user_platform').on(
      table.userId,
      table.platform
    ),
    uniqueIndex('unique_refresh_token_hash').on(table.tokenHash),
  ]
);
