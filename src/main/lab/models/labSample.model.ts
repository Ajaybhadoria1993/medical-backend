import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { LabsModel } from './lab.model';

export const labSampleStatusEnum = pgEnum('lab_sample_status', [
  'NOT_STARTED',
  'SAMPLE_COLLECTION_PENDING',
  'SAMPLE_COLLECTED',
  'SAMPLE_RECEIVED_AT_LAB',
  'SAMPLE_PROCESSING',
  'TESTING_IN_PROGRESS',
  'QUALITY_CHECK',
  'COMPLETED',
  'REJECTED',
]);

export type LabSampleStatus = (typeof labSampleStatusEnum.enumValues)[number];

export const LabSamplesModel = pgTable(
  'lab_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    labOrderId: uuid('lab_order_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    appointmentTestId: uuid('appointment_test_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    patientId: uuid('patient_id').references(() => UserModel.id),
    testId: uuid('test_id').references(() => TestCatalogModel.id),
    sampleType: varchar('sample_type', { length: 100 }),
    barcodeValue: varchar('barcode_value', { length: 40 }).notNull(),
    barcodeType: varchar('barcode_type', { length: 20 })
      .default('CODE128')
      .notNull(),
    status: labSampleStatusEnum('status').default('NOT_STARTED').notNull(),
    collectedBy: uuid('collected_by').references(() => UserModel.id),
    collectedAt: timestamp('collected_at'),
    receivedAtLabBy: uuid('received_at_lab_by').references(() => UserModel.id),
    receivedAtLabAt: timestamp('received_at_lab_at'),
    processingStartedAt: timestamp('processing_started_at'),
    testingStartedAt: timestamp('testing_started_at'),
    resultVerifiedAt: timestamp('result_verified_at'),
    reportReadyAt: timestamp('report_ready_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lab_samples_barcode_value_unique').on(table.barcodeValue),
    uniqueIndex('lab_samples_appointment_test_unique').on(
      table.appointmentTestId
    ),
    index('idx_lab_samples_lab_id').on(table.labId),
    index('idx_lab_samples_lab_order_id').on(table.labOrderId),
    index('idx_lab_samples_patient_id').on(table.patientId),
    index('idx_lab_samples_clinic_id').on(table.clinicId),
    index('idx_lab_samples_status').on(table.status),
    index('idx_lab_samples_lab_id_status').on(table.labId, table.status),
  ]
);
