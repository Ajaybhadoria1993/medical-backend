import {
  integer,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ClinicModel } from '../../clinic/models/clinic.model';
import {
  LabDepartmentsMasterModel,
  LabsModel,
} from '../../lab/models/lab.model';
import { UserModel } from '../../users/models/user.model';

export const labTestsStatusEnum = pgEnum('lab_tests_status', [
  'active',
  'deactive',
  'inactive',
]);

export const labTestSourceEnum = pgEnum('lab_test_source', [
  'master',
  'custom',
]);

export const LabTestCatalogModel = pgTable(
  'lab_test_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    testCode: varchar('test_code', { length: 100 }),
    category: varchar('category', { length: 100 }),
    price: integer('price'),
    clinicId: uuid('clinic_id').references(() => ClinicModel.id),
    labId: uuid('lab_id').references(() => LabsModel.id),
    departmentId: uuid('department_id').references(
      () => LabDepartmentsMasterModel.id
    ),

    sampleType: varchar('sample_type', { length: 100 }),
    createdBy: uuid('created_by').references(() => UserModel.id),
    updatedBy: uuid('updated_by').references(() => UserModel.id),
    source: labTestSourceEnum('source').default('custom').notNull(),
    status: labTestsStatusEnum('status').default('active').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    labDepartmentCustomNameUnique: uniqueIndex(
      'lab_test_catalog_lab_department_custom_name_unique'
    )
      .on(t.labId, t.departmentId, t.name)
      .where(sql`source = 'custom' AND deleted_at IS NULL`),
    labIdx: index('idx_lab_test_catalog_lab_id').on(t.labId),
    departmentIdx: index('idx_lab_test_catalog_department_id').on(
      t.departmentId
    ),
    testCodeIdx: index('idx_lab_test_catalog_test_code').on(t.testCode),
    statusIdx: index('idx_lab_test_catalog_status').on(t.status),
  })
);
