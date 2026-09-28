import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  decimal,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { pharmacyMedicineModel } from './pharmacyMedicine.model';
import { PharmacyStockModel } from './pharmacyStock.model';

export const PharmacyStockMedicineModel = pgTable(
  'pharmacy_stock_medicine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyStockId: uuid('pharmacy_stock_id')
      .references(() => PharmacyStockModel.id)
      .notNull(),
    pharmacyMedicineId: uuid('pharmacy_medicine_id')
      .references(() => pharmacyMedicineModel.id)
      .notNull(),
    batch: varchar('batch', { length: 50 }),
    expiry: timestamp('expiry'),
    quantity: integer('quantity'),
    mrp: decimal('mrp', { precision: 12, scale: 2 }),
    cost: decimal('cost', { precision: 12, scale: 2 }),
    totalCost: decimal('total_cost', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_pharmacy_medicine_batch').on(
      t.pharmacyStockId,
      t.pharmacyMedicineId,
      t.batch
    ),
    index('pharmacy_stock_medicine_stock_id_idx').on(t.pharmacyStockId),
    index('pharmacy_stock_medicine_medicine_id_idx').on(t.pharmacyMedicineId),
    index('pharmacy_stock_medicine_expiry_idx').on(t.expiry),
    index('pharmacy_stock_medicine_quantity_idx').on(t.quantity),
    index('pharmacy_stock_medicine_created_at_idx').on(t.createdAt),
  ]
);
