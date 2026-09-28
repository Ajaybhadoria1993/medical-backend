import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';

export const medicineStatusEnum = pgEnum('medicine_status', [
  'active',
  'inactive',
]);

export const pharmacyMedicineModel = pgTable(
  'pharmacy_medicines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    medicineName: varchar('medicine_name', { length: 200 }).notNull(),
    brandName: varchar('brand_name', { length: 50 }),
    composition: varchar('composition', { length: 200 }),
    category: varchar('category', { length: 100 }),
    hsnId: uuid('hsn_id')
      .references(() => HsnTaxMasterModel.id)
      .notNull(),
    form: varchar('form', { length: 50 }),
    shelf: varchar('shelf', { length: 100 }),
    reorder: integer('reorder'),
    packOf: integer('pack_of'),
    sku: varchar('sku', { length: 50 }),
    status: medicineStatusEnum('status').default('active').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_medicine_name').on(t.medicineName, t.pharmacyId),
    index('pharmacy_medicines_pharmacy_id_idx').on(t.pharmacyId),
    index('pharmacy_medicines_hsn_id_idx').on(t.hsnId),
    index('pharmacy_medicines_status_idx').on(t.status),
  ]
);
