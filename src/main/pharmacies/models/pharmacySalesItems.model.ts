import {
  pgTable,
  uuid,
  timestamp,
  integer,
  decimal,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { PharmacySalesModel } from './pharmacySales.model';
import { PharmacyStockMedicineModel } from './pharmacyStockMedicine.model';

export const PharmacySalesItemsModel = pgTable(
  'pharmacy_sales_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacySalesId: uuid('pharmacy_sales_id')
      .references(() => PharmacySalesModel.id)
      .notNull(),
    pharmacyStockMedicineId: uuid('pharmacy_stock_medicine_id')
      .references(() => PharmacyStockMedicineModel.id)
      .notNull(),
    quantity: integer('quantity').default(0),
    discountPercent: decimal('discount_percent', {
      precision: 12,
      scale: 2,
    }).default('0'),
    total: decimal('total', { precision: 12, scale: 2 }).default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    uniqueIndex('ux_sales_item').on(
      t.pharmacySalesId,
      t.pharmacyStockMedicineId
    ),
    index('pharmacy_sales_items_sales_id_idx').on(t.pharmacySalesId),
    index('pharmacy_sales_items_stock_medicine_idx').on(
      t.pharmacyStockMedicineId
    ),
    index('pharmacy_sales_items_created_at_idx').on(t.createdAt),
  ]
);
