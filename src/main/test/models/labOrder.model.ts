import {
  pgTable,
  pgSequence,
  uuid,
  timestamp,
  pgEnum,
  text,
  integer,
  numeric,
  varchar,
  jsonb,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { TestCatalogModel } from './testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { LabsModel } from '../../lab/models/lab.model';
import {
  LabUpdatedTestModel,
  LabUpdatedTestPackageModel,
} from '../../lab/models/labUpdated.model';

// Rename enum
export const testReportStatusEnum = pgEnum('test_report_status', [
  'Initiated',
  'InProgress',
  'Collected',
  'Completed',
]);

// Backs AppointmentTestService.generateUniqueTestId's nextval() call
export const appointmentTestUniqueIdSeq = pgSequence(
  'appointment_test_unique_id_seq'
);

// Backs AppointmentTestService.generateSampleBarcodeValue's nextval() call
export const labSampleBarcodeSeq = pgSequence('lab_sample_barcode_seq');

// Backs AppointmentTestService's lab invoice number generation nextval() call
export const labInvoiceNumberSeq = pgSequence('lab_invoice_number_seq');

export const IndependentPatientModel = pgTable('independent_patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  mobile: varchar('mobile', { length: 20 }).notNull(),
  age: integer('age').notNull(),
  gender: varchar('gender', { length: 50 }).notNull(),
  doctorName: varchar('doctor_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const LabOrderModel = pgTable(
  'lab_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    appointmentId: uuid('appointment_id').references(
      () => AppointmentModel.id,
      {
        onDelete: 'cascade',
      }
    ),

    testId: uuid('test_id').references(() => TestCatalogModel.id, {
      onDelete: 'cascade',
    }),

    labUpdatedTestId: uuid('lab_updated_test_id').references(
      () => LabUpdatedTestModel.id,
      { onDelete: 'set null' }
    ),

    labUpdatedTestPackageId: uuid('lab_updated_test_package_id').references(
      () => LabUpdatedTestPackageModel.id,
      { onDelete: 'set null' }
    ),

    isIndependent: boolean('is_independent').default(false).notNull(),

    // One id per patient visit, so tests added later join the same order group.
    labOrderGroupId: uuid('lab_order_group_id'),

    independentPatientId: uuid('independent_patient_id').references(
      () => IndependentPatientModel.id
    ),

    patientId: uuid('patient_id').references(() => UserModel.id),

    doctorId: uuid('doctor_id').references(() => UserModel.id),

    referringDoctorName: varchar('referring_doctor_name', { length: 255 }),

    clinicId: uuid('clinic_id').references(() => ClinicModel.id),

    // Use the renamed enum
    reportStatus: testReportStatusEnum('test_report_status')
      .default('Initiated')
      .notNull(),

    reportPdf: text('report_pdf'),

    discountPercent: numeric('discount_percent', {
      precision: 5,
      scale: 2,
    })
      .default('0')
      .notNull(),

    workflowStatus: varchar('workflow_status', { length: 50 })
      .default('INITIATED')
      .notNull(),
    sampleStatus: varchar('sample_status', { length: 50 }).default(
      'NOT_STARTED'
    ),
    sampleCode: varchar('sample_code', { length: 30 }),
    onHoldAt: timestamp('on_hold_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    appointmentIdIdx: index('idx_lab_orders_appointment_id').on(
      table.appointmentId
    ),
    testIdIdx: index('idx_lab_orders_test_id').on(table.testId),
    labUpdatedTestIdIdx: index('idx_lab_orders_lab_updated_test_id').on(
      table.labUpdatedTestId
    ),
    labUpdatedTestPackageIdIdx: index(
      'idx_lab_orders_lab_updated_test_package_id'
    ).on(table.labUpdatedTestPackageId),
    labOrderGroupIdIdx: index('idx_lab_orders_lab_order_group_id').on(
      table.labOrderGroupId
    ),
    patientIdIdx: index('idx_lab_orders_patient_id').on(table.patientId),
    doctorIdIdx: index('idx_lab_orders_doctor_id').on(table.doctorId),
    clinicIdIdx: index('idx_lab_orders_clinic_id').on(table.clinicId),
    reportStatusIdx: index('idx_lab_orders_report_status').on(
      table.reportStatus
    ),
    workflowStatusIdx: index('idx_lab_orders_workflow_status').on(
      table.workflowStatus
    ),
    sampleStatusIdx: index('idx_lab_orders_sample_status').on(
      table.sampleStatus
    ),
    clinicReportStatusIdx: index('idx_lab_orders_clinic_report_status').on(
      table.clinicId,
      table.reportStatus
    ),
  })
);

export const LabOrderTrackingEventModel = pgTable(
  'lab_order_tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    appointmentTestId: uuid('appointment_test_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    actorUserId: uuid('actor_user_id').references(() => UserModel.id),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    appointmentTestIdIdx: index(
      'idx_lab_order_tracking_events_appointment_test_id'
    ).on(table.appointmentTestId),
    clinicIdIdx: index('idx_lab_order_tracking_events_clinic_id').on(
      table.clinicId
    ),
    labIdIdx: index('idx_lab_order_tracking_events_lab_id').on(table.labId),
    createdAtIdx: index('idx_lab_order_tracking_events_created_at').on(
      table.createdAt
    ),
  })
);
