import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';

export const supplierStatusEnum = pgEnum('supplier_status', [
  'active',
  'inactive',
]);

export const PharmacySupplierModel = pgTable(
  'pharmacy_suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    supplierName: varchar('supplier_name', { length: 100 }).notNull(),
    contactPerson: varchar('contact_person', { length: 50 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 60 }).unique(),
    address: text('address'),
    gstNumber: varchar('gst_number', { length: 30 }),
    panNumber: varchar('pan_number', { length: 20 }),
    creditDays: integer('credit_days').default(0),
    status: supplierStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_supplier_name_pharmacy').on(t.pharmacyId, t.supplierName),
    index('pharmacy_suppliers_pharmacy_id_idx').on(t.pharmacyId),
    index('pharmacy_suppliers_status_idx').on(t.status),
    index('pharmacy_suppliers_phone_idx').on(t.phone),
    index('pharmacy_suppliers_gst_number_idx').on(t.gstNumber),
    index('pharmacy_suppliers_created_at_idx').on(t.createdAt),
    index('pharmacy_suppliers_pharmacy_status_idx').on(t.pharmacyId, t.status),
  ]
);
