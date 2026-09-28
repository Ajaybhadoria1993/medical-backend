import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { UserModel } from './user.model';

export const UserDevicesModel = pgTable('user_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => UserModel.id, { onDelete: 'cascade' })
    .notNull(),
  deviceToken: varchar('device_token', { length: 255 }).notNull().unique(),
  platform: varchar('platform', { length: 20 })
    .$type<'ios' | 'android'>()
    .notNull(),
  snsEndpointArn: varchar('sns_endpoint_arn', { length: 500 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
