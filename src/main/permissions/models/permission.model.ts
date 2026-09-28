import {
  boolean,
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

export const permissionAuditActionEnum = pgEnum('permission_audit_action', [
  'granted',
  'revoked',
]);

export const PermissionsModel = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 120 }).notNull(),
    resource: varchar('resource', { length: 60 }).notNull(),
    action: varchar('action', { length: 60 }).notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    keyUnique: uniqueIndex('permissions_key_unique').on(table.key),
    resourceIdx: index('idx_permissions_resource').on(table.resource),
  })
);

export const UserPermissionsModel = pgTable(
  'user_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: uuid('permission_id')
      .references(() => PermissionsModel.id, { onDelete: 'cascade' })
      .notNull(),
    grantedBy: uuid('granted_by').references(() => UserModel.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userClinicPermissionUnique: uniqueIndex(
      'user_permissions_user_clinic_permission_unique'
    ).on(table.userId, table.clinicId, table.permissionId),
    userClinicIdx: index('idx_user_permissions_user_clinic').on(
      table.userId,
      table.clinicId
    ),
  })
);

// permission_key is stored as text, not an FK: history must stay readable after a
// permission is removed from the catalog.
export const PermissionAuditLogModel = pgTable(
  'permission_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    targetUserId: uuid('target_user_id')
      .references(() => UserModel.id)
      .notNull(),
    performedBy: uuid('performed_by')
      .references(() => UserModel.id)
      .notNull(),
    permissionKey: varchar('permission_key', { length: 120 }).notNull(),
    action: permissionAuditActionEnum('action').notNull(),
    performedAt: timestamp('performed_at').defaultNow().notNull(),
  },
  (table) => ({
    targetUserIdx: index('idx_permission_audit_log_target_user').on(
      table.targetUserId,
      table.clinicId
    ),
    clinicKeyIdx: index('idx_permission_audit_log_clinic_key').on(
      table.clinicId,
      table.permissionKey,
      table.performedAt
    ),
  })
);
