import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { LabTestCatalogModel } from './labTestCatalog.model';
import { sql } from 'drizzle-orm';

export const patientsTestStatusEnum = pgEnum('patients_test_status', [
  'active',
  'deactive',
]);

export const TestCatalogModel = pgTable(
  'test_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }),
    clinicId: uuid('clinic_id').references(() => ClinicModel.id),
    doctorId: uuid('doctor_id').references(() => UserModel.id),
    labTestId: uuid('lab_test_id').references(() => LabTestCatalogModel.id, {
      onDelete: 'set null',
    }),
    price: integer('price'),
    status: patientsTestStatusEnum('status').default('active').notNull(),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    clinicNameUnique: uniqueIndex('test_catalog_clinic_name_unique')
      .on(t.clinicId, t.name)
      .where(sql`is_deleted = false`),
    globalNameUnique: uniqueIndex('test_catalog_global_name_unique')
      .on(t.name)
      .where(sql`clinic_id IS NULL AND is_deleted = false`),
    doctorIdIdx: index('idx_test_catalog_doctor_id').on(t.doctorId),
    statusIdx: index('idx_test_catalog_status').on(t.status),
    labTestIdIdx: index('idx_test_catalog_lab_test_id').on(t.labTestId),
  })
);
