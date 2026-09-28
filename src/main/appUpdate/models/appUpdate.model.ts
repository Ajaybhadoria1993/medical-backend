import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const AppUpdateConfigModel = pgTable(
  'app_update_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    app_name: varchar('app_name', { length: 50 }).notNull(),
    platform: varchar('platform', { length: 20 })
      .$type<'ios' | 'android'>()
      .notNull(),
    force_update: boolean('force_update').notNull().default(false),
    store_url: varchar('store_url', { length: 2048 }).notNull().default(''),
    latest_version: varchar('latest_version', { length: 50 }).notNull(),
    minimum_version: varchar('minimum_version', { length: 50 })
      .notNull()
      .default('1.0.0'),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ux_app_update_app_platform').on(
      table.app_name,
      table.platform
    ),
  ]
);
