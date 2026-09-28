import {
  decimal,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { LabsModel } from './lab.model';

export const LabInvoiceModel = pgTable(
  'lab_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 40 }).notNull(),
    appointmentTestId: uuid('appointment_test_id')
      .references(() => LabOrderModel.id, { onDelete: 'cascade' })
      .notNull(),
    testId: uuid('test_id').references(() => TestCatalogModel.id),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id)
      .notNull(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id)
      .notNull(),
    patientId: uuid('patient_id').references(() => UserModel.id),
    doctorId: uuid('doctor_id').references(() => UserModel.id),
    createdBy: uuid('created_by').references(() => UserModel.id),
    paymentMethod: varchar('payment_method', { length: 30 }).notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 })
      .default('0')
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lab_invoices_invoice_number_unique').on(table.invoiceNumber),
    uniqueIndex('lab_invoices_appointment_test_unique').on(
      table.appointmentTestId
    ),
    index('idx_lab_invoices_lab_id').on(table.labId),
    index('idx_lab_invoices_clinic_id').on(table.clinicId),
    index('idx_lab_invoices_test_id').on(table.testId),
    index('idx_lab_invoices_created_at').on(table.createdAt),
    index('idx_lab_invoices_patient_id').on(table.patientId),
    index('idx_lab_invoices_doctor_id').on(table.doctorId),
  ]
);
