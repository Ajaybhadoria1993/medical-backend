import {
  pgTable,
  pgSequence,
  uuid,
  timestamp,
  pgEnum,
  text,
  integer,
  varchar,
  jsonb,
  uniqueIndex,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { TestCatalogModel } from './testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { LabsModel } from '../../lab/models/lab.model';

// Rename enum
export const testReportStatusEnum = pgEnum('test_report_status', [
  'Initiated',
  'InProgress',
  'Completed',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'failed',
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
    uniqueTestId: varchar('unique_test_id', { length: 20 }),

    appointmentId: uuid('appointment_id').references(
      () => AppointmentModel.id,
      {
        onDelete: 'cascade',
      }
    ),

    testId: uuid('test_id')
      .references(() => TestCatalogModel.id, { onDelete: 'cascade' })
      .notNull(),

    isIndependent: boolean('is_independent').default(false).notNull(),

    isExternalLabReport: boolean('is_external_lab_report')
      .default(false)
      .notNull(),

    independentPatientId: uuid('independent_patient_id').references(
      () => IndependentPatientModel.id
    ),

    patientId: uuid('patient_id').references(() => UserModel.id),

    doctorId: uuid('doctor_id').references(() => UserModel.id),

    clinicId: uuid('clinic_id').references(() => ClinicModel.id),

    labAssistantId: uuid('lab_assistant_id').references(() => UserModel.id),

    // Use the renamed enum
    reportStatus: testReportStatusEnum('test_report_status')
      .default('Initiated')
      .notNull(),

    paymentStatus: paymentStatusEnum('payment_status')
      .default('pending')
      .notNull(),

    price: integer('price').default(0),

    reportPdf: text('report_pdf'),

    workflowStatus: varchar('workflow_status', { length: 50 })
      .default('INITIATED')
      .notNull(),
    sampleStatus: varchar('sample_status', { length: 50 }).default(
      'NOT_STARTED'
    ),
    onHoldAt: timestamp('on_hold_at'),
    rejectedAt: timestamp('rejected_at'),
    rejectionReason: text('rejection_reason'),
    paymentCollectedAt: timestamp('payment_collected_at'),
    paymentCollectedBy: uuid('payment_collected_by').references(
      () => UserModel.id
    ),
    sampleCollectedAt: timestamp('sample_collected_at'),
    sampleReceivedAt: timestamp('sample_received_at'),
    processingStartedAt: timestamp('processing_started_at'),
    testingStartedAt: timestamp('testing_started_at'),
    qualityCheckedAt: timestamp('quality_checked_at'),
    expectedReportReadyAt: timestamp('expected_report_ready_at'),
    readyForReportAt: timestamp('ready_for_report_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    uniqueTestIdUnique: uniqueIndex('lab_orders_unique_test_id_unique').on(
      table.uniqueTestId
    ),
    appointmentIdIdx: index('idx_lab_orders_appointment_id').on(
      table.appointmentId
    ),
    testIdIdx: index('idx_lab_orders_test_id').on(table.testId),
    patientIdIdx: index('idx_lab_orders_patient_id').on(table.patientId),
    doctorIdIdx: index('idx_lab_orders_doctor_id').on(table.doctorId),
    clinicIdIdx: index('idx_lab_orders_clinic_id').on(table.clinicId),
    labAssistantIdIdx: index('idx_lab_orders_lab_assistant_id').on(
      table.labAssistantId
    ),
    reportStatusIdx: index('idx_lab_orders_report_status').on(
      table.reportStatus
    ),
    paymentStatusIdx: index('idx_lab_orders_payment_status').on(
      table.paymentStatus
    ),
    workflowStatusIdx: index('idx_lab_orders_workflow_status').on(
      table.workflowStatus
    ),
    sampleStatusIdx: index('idx_lab_orders_sample_status').on(
      table.sampleStatus
    ),
    labAssistantCreatedAtIdx: index(
      'idx_lab_orders_lab_assistant_created_at'
    ).on(table.labAssistantId, table.createdAt),
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
