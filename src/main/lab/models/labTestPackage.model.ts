import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { LabTestCatalogModel } from '../../test/models/labTestCatalog.model';
import { LabsModel } from './lab.model';

export const labTestPackageStatusEnum = pgEnum('lab_test_package_status', [
  'Active',
  'Inactive',
]);

export const LabTestPackageModel = pgTable(
  'lab_test_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    packageName: varchar('package_name', { length: 50 }).notNull(),
    packageCode: varchar('package_code', { length: 30 }).notNull(),
    packageDescription: varchar('package_description', {
      length: 200,
    }).notNull(),
    packagePrice: integer('package_price').notNull(),
    status: labTestPackageStatusEnum('status').default('Active').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    labPackageCodeUnique: uniqueIndex('lab_test_packages_lab_code_unique')
      .on(table.labId, table.packageCode)
      .where(sql`deleted_at IS NULL`),
    labIdIdx: index('idx_lab_test_packages_lab_id').on(table.labId),
    statusIdx: index('idx_lab_test_packages_status').on(table.status),
  })
);

export const LabTestPackageItemModel = pgTable(
  'lab_test_package_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .references(() => LabTestPackageModel.id, { onDelete: 'cascade' })
      .notNull(),
    labTestId: uuid('lab_test_id')
      .references(() => LabTestCatalogModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    packageLabTestUnique: uniqueIndex(
      'lab_test_package_items_package_lab_test_unique'
    ).on(table.packageId, table.labTestId),
    packageIdIdx: index('idx_lab_test_package_items_package_id').on(
      table.packageId
    ),
    labTestIdIdx: index('idx_lab_test_package_items_lab_test_id').on(
      table.labTestId
    ),
  })
);
