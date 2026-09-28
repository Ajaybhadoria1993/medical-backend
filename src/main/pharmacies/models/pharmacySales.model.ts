import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  decimal,
  index,
} from 'drizzle-orm/pg-core';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { UserModel } from '../../users/models';
import { PrescriptionQueueModel } from '../../pharmacy/models/prescriptionQueue.model';

export const PharmacySalesModel = pgTable(
  'pharmacy_sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),
    prescriptionId: uuid('prescription_id').references(
      () => PrescriptionQueueModel.id
    ),
    patientName: varchar('patient_name', { length: 50 }),
    patientMobile: varchar('patient_mobile', { length: 15 }),
    paymentMethod: varchar('payment_method'),
    paymentNotes: varchar('payment_notes', { length: 100 }),
    totalItems: integer('total_items').default(0),
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0'),
    gstAmount: decimal('gst_amount', { precision: 12, scale: 2 }).default('0'),
    discountAmount: decimal('discount_amount', {
      precision: 12,
      scale: 2,
    }).default('0'),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default(
      '0'
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pharmacyIdIdx: index('pharmacy_sales_pharmacy_id_idx').on(table.pharmacyId),
    createdByIdx: index('pharmacy_sales_created_by_idx').on(table.createdBy),
    createdAtIdx: index('pharmacy_sales_created_at_idx').on(table.createdAt),
    prescriptionIdIdx: index('pharmacy_sales_prescription_id_idx').on(
      table.prescriptionId
    ),
    pharmacyCreatedAtIdx: index('pharmacy_sales_pharmacy_created_idx').on(
      table.pharmacyId,
      table.createdAt
    ),
  })
);
