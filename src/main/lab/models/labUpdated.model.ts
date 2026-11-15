import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { UserModel } from '../../users/models/user.model';
import { LabsModel } from './lab.model';

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'failed',
]);

export const labHomeCollectionUnitEnum = pgEnum('lab_home_collection_unit', [
  'm',
  'km',
]);

export const LabUpdatedDepartmentModel = pgTable(
  'lab_updated_department',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labCodeUnique: uniqueIndex('ux_lab_updated_department_lab_code').on(
      table.labId,
      table.code
    ),
    labNameUnique: uniqueIndex('ux_lab_updated_department_lab_name').on(
      table.labId,
      table.name
    ),
    labIdIdx: index('idx_lab_updated_department_lab_id').on(table.labId),
    statusIdx: index('idx_lab_updated_department_status').on(table.status),
  })
);

export const LabUpdatedTestGroupModel = pgTable(
  'lab_updated_test_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labNameUnique: uniqueIndex('ux_lab_updated_test_groups_lab_name').on(
      table.labId,
      table.name
    ),
    labIdIdx: index('idx_lab_updated_test_groups_lab_id').on(table.labId),
    statusIdx: index('idx_lab_updated_test_groups_status').on(table.status),
  })
);

export const LabUpdatedTestModel = pgTable(
  'lab_updated_tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    testName: varchar('test_name', { length: 255 }).notNull(),
    shortName: varchar('short_name', { length: 100 }),
    loincCode: varchar('loinc_code', { length: 30 }),
    comments: text('comments'),
    interpretation: text('interpretation'),
    notes: text('notes'),
    testCode: varchar('test_code', { length: 100 }).notNull(),
    sampleType: varchar('sample_type', { length: 100 }).notNull(),
    container: varchar('container', { length: 100 }),
    sampleVolume: varchar('sample_volume', { length: 100 }),
    stability: text('stability'),
    storage: text('storage'),
    method: text('method'),
    technology: varchar('technology', { length: 150 }),
    testType: varchar('test_type', { length: 50 }),
    turnaroundTimeHours: integer('turnaround_time_hours'),
    clinicalSignificance: text('clinical_significance'),
    limitations: text('limitations'),
    advice: text('advice'),
    testDisclaimer: text('test_disclaimer'),
    whenResultHigh: text('when_result_high'),
    whenResultLow: text('when_result_low'),
    whenResultCritical: text('when_result_critical'),
    price: integer('price').notNull(),
    departmentId: uuid('department_id')
      .references(() => LabUpdatedDepartmentModel.id)
      .notNull(),
    groupId: uuid('group_id').references(() => LabUpdatedTestGroupModel.id),
    version: integer('version').default(0).notNull(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labTestCodeUnique: uniqueIndex('ux_lab_updated_tests_lab_code').on(
      table.labId,
      table.testCode
    ),
    labDepartmentNameUnique: uniqueIndex(
      'ux_lab_updated_tests_lab_department_name'
    ).on(table.labId, table.departmentId, table.testName),
    labIdIdx: index('idx_lab_updated_tests_lab_id').on(table.labId),
    departmentIdIdx: index('idx_lab_updated_tests_department_id').on(
      table.departmentId
    ),
    groupIdIdx: index('idx_lab_updated_tests_group_id').on(table.groupId),
    statusIdx: index('idx_lab_updated_tests_status').on(table.status),
    testCodeIdx: index('idx_lab_updated_tests_test_code').on(table.testCode),
  })
);

export const LabUpdatedTestAliasModel = pgTable(
  'lab_updated_test_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testId: uuid('test_id')
      .references(() => LabUpdatedTestModel.id, { onDelete: 'cascade' })
      .notNull(),
    alias: varchar('alias', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    testAliasUnique: uniqueIndex('ux_lab_updated_test_aliases_test_alias').on(
      table.testId,
      table.alias
    ),
    testIdIdx: index('idx_lab_updated_test_aliases_test_id').on(table.testId),
  })
);

export const LabTestResultParameterModel = pgTable(
  'lab_updated_test_result_parameters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testId: uuid('test_id')
      .references(() => LabUpdatedTestModel.id, { onDelete: 'cascade' })
      .notNull(),
    parameterName: varchar('parameter_name', { length: 255 }).notNull(),
    code: varchar('code', { length: 50 }),
    inputType: varchar('input_type', { length: 30 }).default('text').notNull(),
    unit: varchar('unit', { length: 80 }),
    unitless: boolean('unitless').default(false).notNull(),
    decimals: integer('decimals').default(1).notNull(),
    section: varchar('section', { length: 150 }),
    formula: text('formula'),
    // Deprecated: superseded by LabUpdatedParameterReferenceRangeModel. Drop only
    // after create/update/report-generation code stops reading this column (see
    // docs/playbook migration notes for the lab catalog rework).
    referenceRange: varchar('reference_range', { length: 255 }),
    isRequired: boolean('is_required').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    testParameterUnique: uniqueIndex(
      'ux_lab_updated_test_result_parameters_test_name'
    )
      .on(table.testId, table.parameterName)
      .where(sql`is_active = true`),
    testIdIdx: index('idx_lab_updated_test_result_parameters_test_id').on(
      table.testId
    ),
    activeIdx: index('idx_lab_updated_test_result_parameters_active').on(
      table.isActive
    ),
  })
);

export const LabUpdatedParameterReferenceRangeModel = pgTable(
  'lab_updated_parameter_reference_ranges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parameterId: uuid('parameter_id')
      .references(() => LabTestResultParameterModel.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    gender: varchar('gender', { length: 20 }).default('All').notNull(),
    ageFromYears: numeric('age_from_years', { precision: 6, scale: 3 }),
    ageToYears: numeric('age_to_years', { precision: 6, scale: 3 }),
    condition: varchar('condition', { length: 100 }),
    type: varchar('type', { length: 20 }).default('range').notNull(),
    lowRange: numeric('low_range', { precision: 12, scale: 4 }),
    highRange: numeric('high_range', { precision: 12, scale: 4 }),
    label: varchar('label', { length: 100 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    parameterIdIdx: index(
      'idx_lab_updated_parameter_reference_ranges_parameter_id'
    ).on(table.parameterId),
  })
);

export const LabUpdatedParameterOptionModel = pgTable(
  'lab_updated_parameter_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parameterId: uuid('parameter_id')
      .references(() => LabTestResultParameterModel.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    optionValue: varchar('option_value', { length: 100 }).notNull(),
    isNormal: boolean('is_normal').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    parameterIdIdx: index('idx_lab_updated_parameter_options_parameter_id').on(
      table.parameterId
    ),
  })
);

export const LabUpdatedTestPackageModel = pgTable(
  'lab_updated_test_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    packageName: varchar('package_name', { length: 100 }).notNull(),
    packageCode: varchar('package_code', { length: 50 }).notNull(),
    packagePrice: integer('package_price').notNull(),
    status: varchar('status', { length: 20 }).default('Active').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labPackageCodeUnique: uniqueIndex('ux_lab_updated_test_packages_lab_code')
      .on(table.labId, table.packageCode)
      .where(sql`deleted_at IS NULL`),
    labPackageNameUnique: uniqueIndex('ux_lab_updated_test_packages_lab_name')
      .on(table.labId, table.packageName)
      .where(sql`deleted_at IS NULL`),
    labIdIdx: index('idx_lab_updated_test_packages_lab_id').on(table.labId),
    statusIdx: index('idx_lab_updated_test_packages_status').on(table.status),
  })
);

export const LabUpdatedTestPackageItemModel = pgTable(
  'lab_updated_test_package_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .references(() => LabUpdatedTestPackageModel.id, { onDelete: 'cascade' })
      .notNull(),
    labTestId: uuid('lab_test_id')
      .references(() => LabUpdatedTestModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    packageLabTestUnique: uniqueIndex(
      'ux_lab_updated_test_package_items_package_test'
    ).on(table.packageId, table.labTestId),
    packageIdIdx: index('idx_lab_updated_test_package_items_package_id').on(
      table.packageId
    ),
    labTestIdIdx: index('idx_lab_updated_test_package_items_lab_test_id').on(
      table.labTestId
    ),
  })
);

export const LabUpdatedHomeCollectionModel = pgTable(
  'lab_updated_home_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    fromRange: numeric('from_range', { precision: 10, scale: 2 }).notNull(),
    toRange: numeric('to_range', { precision: 10, scale: 2 }).notNull(),
    unit: labHomeCollectionUnitEnum('unit').default('km').notNull(),
    price: integer('price').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labIdIdx: index('idx_lab_updated_home_collections_lab_id').on(table.labId),
    activeIdx: index('idx_lab_updated_home_collections_active').on(
      table.isActive
    ),
    rangeIdx: index('idx_lab_updated_home_collections_range').on(
      table.labId,
      table.unit,
      table.fromRange,
      table.toRange
    ),
  })
);

export const LabUpdatedOrderHomeCollectionModel = pgTable(
  'lab_updated_order_home_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    patientId: uuid('patient_id')
      .references(() => UserModel.id)
      .notNull(),
    homeCollectionPrice: integer('home_collection_price').notNull(),
    rateId: uuid('rate_id').references(() => LabUpdatedHomeCollectionModel.id),
    distance: numeric('distance', { precision: 10, scale: 2 }),
    unit: labHomeCollectionUnitEnum('unit'),
    labOrderIds: uuid('lab_order_ids').array().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labIdIdx: index('idx_lab_updated_order_home_collections_lab_id').on(
      table.labId
    ),
    patientIdIdx: index('idx_lab_updated_order_home_collections_patient_id').on(
      table.patientId
    ),
    rateIdIdx: index('idx_lab_updated_order_home_collections_rate_id').on(
      table.rateId
    ),
  })
);

// History of payments toward a home collection fee, same insert-only,
// latest-wins pattern as LabUpdatedPaymentModel — kept separate since a home
// collection charge belongs to a visit, not to any single lab_orders row.
export const LabUpdatedHomeCollectionPaymentModel = pgTable(
  'lab_updated_home_collection_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    homeCollectionId: uuid('home_collection_id')
      .references(() => LabUpdatedOrderHomeCollectionModel.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    price: integer('price').default(0),
    paymentStatus: paymentStatusEnum('payment_status')
      .default('pending')
      .notNull(),
    paymentMode: varchar('payment_mode', { length: 20 }),
    paymentNotes: text('payment_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    homeCollectionIdIdx: index(
      'idx_lab_updated_home_collection_payments_home_collection_id'
    ).on(table.homeCollectionId),
  })
);

export const LabUpdatedPaymentModel = pgTable(
  'lab_updated_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labOrderId: uuid('lab_order_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    price: integer('price').default(0),
    paymentStatus: paymentStatusEnum('payment_status')
      .default('pending')
      .notNull(),
    paymentType: varchar('payment_type', { length: 20 })
      .default('test')
      .notNull(),
    paymentMode: varchar('payment_mode', { length: 20 }),
    paymentNotes: text('payment_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labOrderIdIdx: index('idx_lab_updated_payments_lab_order_id').on(
      table.labOrderId
    ),
    paymentStatusIdx: index('idx_lab_updated_payments_payment_status').on(
      table.paymentStatus
    ),
  })
);

export const LabUpdatedActivityModel = pgTable(
  'lab_updated_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    labOrderId: uuid('lab_order_id')
      .references(() => LabOrderModel.id)
      .notNull(),
    activity: text('activity').notNull(),
    performedBy: uuid('performed_by')
      .references(() => UserModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    labIdIdx: index('idx_lab_updated_activity_lab_id').on(table.labId),
    labOrderIdIdx: index('idx_lab_updated_activity_lab_order_id').on(
      table.labOrderId
    ),
    performedByIdx: index('idx_lab_updated_activity_performed_by').on(
      table.performedBy
    ),
    createdAtIdx: index('idx_lab_updated_activity_created_at').on(
      table.createdAt
    ),
  })
);

export const LabUpdatedResultModel = pgTable(
  'lab_updated_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labOrderId: uuid('lab_order_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    parameterId: uuid('parameter_id')
      .references(() => LabTestResultParameterModel.id, { onDelete: 'cascade' })
      .notNull(),
    resultValue: text('result_value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orderParameterUnique: uniqueIndex(
      'ux_lab_updated_result_order_parameter'
    ).on(table.labOrderId, table.parameterId),
    labOrderIdIdx: index('idx_lab_updated_result_lab_order_id').on(
      table.labOrderId
    ),
    parameterIdIdx: index('idx_lab_updated_result_parameter_id').on(
      table.parameterId
    ),
  })
);

export const LabUpdatedReportModel = pgTable(
  'lab_updated_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    templateName: varchar('template_name', { length: 100 })
      .default('labReportTemplate1')
      .notNull(),
    color1: varchar('color1', { length: 20 }).notNull(),
    color2: varchar('color2', { length: 20 }).notNull(),
    color3: varchar('color3', { length: 20 }).notNull(),
    color4: varchar('color4', { length: 20 }).notNull(),
    color5: varchar('color5', { length: 20 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    labIdUnique: uniqueIndex('ux_lab_updated_report_lab_id').on(table.labId),
    labIdIdx: index('idx_lab_updated_report_lab_id').on(table.labId),
  })
);
