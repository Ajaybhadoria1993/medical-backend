import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { UserModel } from '../../users/models/user.model';
import { LabsModel } from './lab.model';

export const labResultStatusEnum = pgEnum('lab_result_status', [
  'Draft',
  'Completed',
  'Verified',
]);

export const labResultFlagEnum = pgEnum('lab_result_flag', [
  'Low',
  'Normal',
  'High',
  'Abnormal',
  'Not Applicable',
]);

export const labParameterSourceTypeEnum = pgEnum('lab_parameter_source_type', [
  'DEFAULT',
  'CUSTOM',
]);

export const LabReportTemplatesModel = pgTable(
  'lab_report_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id').references(() => LabsModel.id),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    sampleType: varchar('sample_type', { length: 100 }).notNull(),
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_lab_report_templates_lab_id').on(table.labId),
    uniqueIndex('ux_lab_report_templates_code_global')
      .on(table.code)
      .where(sql`${table.labId} IS NULL`),
    uniqueIndex('ux_lab_report_templates_lab_code')
      .on(table.labId, table.code)
      .where(sql`${table.labId} IS NOT NULL`),
  ]
);

export const LabReportTemplateParametersModel = pgTable(
  'lab_report_template_parameters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .references(() => LabReportTemplatesModel.id, { onDelete: 'cascade' })
      .notNull(),
    baseParameterId: uuid('base_parameter_id').references(
      (): AnyPgColumn => LabReportTemplateParametersModel.id,
      { onDelete: 'cascade' }
    ),
    labId: uuid('lab_id').references(() => LabsModel.id),
    sectionName: varchar('section_name', { length: 255 }),
    parameterName: varchar('parameter_name', { length: 255 }).notNull(),
    unit: varchar('unit', { length: 80 }),
    referenceRange: varchar('reference_range', { length: 255 }),
    inputType: varchar('input_type', { length: 50 }).default('text').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isRequired: boolean('is_required').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isHidden: boolean('is_hidden').default(false).notNull(),
    sourceType: labParameterSourceTypeEnum('source_type')
      .default('DEFAULT')
      .notNull(),
    isCustom: boolean('is_custom').default(false).notNull(),
    createdBy: uuid('created_by').references(() => UserModel.id),
    updatedBy: uuid('updated_by').references(() => UserModel.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_lab_report_template_parameters_template_id').on(
      table.templateId
    ),
    index('idx_lab_report_template_parameters_lab_id').on(table.labId),
    index('idx_lab_report_template_parameters_base_parameter_id').on(
      table.baseParameterId
    ),
    uniqueIndex('ux_lab_report_template_parameters_default_override')
      .on(table.templateId, table.labId, table.createdBy, table.baseParameterId)
      .where(
        sql`${table.labId} IS NOT NULL AND ${table.sourceType} = 'DEFAULT' AND ${table.isCustom} = false AND ${table.baseParameterId} IS NOT NULL`
      ),
    uniqueIndex('ux_lab_report_template_parameters_global_default')
      .on(table.templateId, table.parameterName)
      .where(sql`${table.labId} IS NULL AND ${table.sourceType} = 'DEFAULT'`),
  ]
);

export const LabOrderResultsModel = pgTable(
  'lab_order_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labOrderId: uuid('lab_order_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    appointmentTestId: uuid('appointment_test_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    templateId: uuid('template_id')
      .references(() => LabReportTemplatesModel.id)
      .notNull(),
    status: labResultStatusEnum('status').default('Draft').notNull(),
    enteredBy: uuid('entered_by').references(() => UserModel.id),
    verifiedBy: uuid('verified_by').references(() => UserModel.id),
    verifiedAt: timestamp('verified_at'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_lab_order_results_lab_order_id').on(table.labOrderId),
    index('idx_lab_order_results_appointment_test_id').on(
      table.appointmentTestId
    ),
    uniqueIndex('ux_lab_order_results_order_test_template').on(
      table.labOrderId,
      table.appointmentTestId,
      table.templateId
    ),
  ]
);

export const LabOrderResultValuesModel = pgTable(
  'lab_order_result_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resultId: uuid('result_id')
      .references(() => LabOrderResultsModel.id, { onDelete: 'cascade' })
      .notNull(),
    parameterId: uuid('parameter_id')
      .references(() => LabReportTemplateParametersModel.id)
      .notNull(),
    parameterNameSnapshot: varchar('parameter_name_snapshot', {
      length: 255,
    }).notNull(),
    displayNameSnapshot: varchar('display_name_snapshot', { length: 255 }),
    value: text('value').notNull(),
    sectionNameSnapshot: varchar('section_name_snapshot', { length: 255 }),
    unitSnapshot: varchar('unit_snapshot', { length: 80 }),
    referenceRangeSnapshot: varchar('reference_range_snapshot', {
      length: 255,
    }),
    inputTypeSnapshot: varchar('input_type_snapshot', { length: 50 }),
    sortOrderSnapshot: integer('sort_order_snapshot'),
    isRequiredSnapshot: boolean('is_required_snapshot'),
    sourceTypeSnapshot: labParameterSourceTypeEnum('source_type_snapshot')
      .default('DEFAULT')
      .notNull(),
    isCustomSnapshot: boolean('is_custom_snapshot').default(false).notNull(),
    flag: labResultFlagEnum('flag').default('Not Applicable').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_lab_order_result_values_result_id').on(table.resultId),
    index('idx_lab_order_result_values_parameter_id').on(table.parameterId),
    uniqueIndex('ux_lab_order_result_values_result_parameter').on(
      table.resultId,
      table.parameterId
    ),
  ]
);
