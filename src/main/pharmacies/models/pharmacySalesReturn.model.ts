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
import { PharmacySalesModel } from './pharmacySales.model';
import { PharmacySalesItemsModel } from './pharmacySalesItems.model';
import { PharmacyStockMedicineModel } from './pharmacyStockMedicine.model';

export const PharmacySalesReturnModel = pgTable(
  'pharmacy_sales_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    saleId: uuid('sale_id')
      .references(() => PharmacySalesModel.id)
      .notNull(),
    gstAmountReturn: decimal('gst_amount_return', {
      precision: 12,
      scale: 2,
    }).default('0'),
    totalReturnAmount: decimal('total_return_amount', {
      precision: 12,
      scale: 2,
    }).default('0'),
    refundMethod: varchar('refund_method'),
    returnReason: varchar('return_reason', { length: 255 }),
    refundNotes: varchar('refund_notes', { length: 255 }),
    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pharmacyIdIdx: index('pharmacy_sales_returns_pharmacy_id_idx').on(
      table.pharmacyId
    ),
    saleIdIdx: index('pharmacy_sales_returns_sale_id_idx').on(table.saleId),
    createdByIdx: index('pharmacy_sales_returns_created_by_idx').on(
      table.createdBy
    ),
    createdAtIdx: index('pharmacy_sales_returns_created_at_idx').on(
      table.createdAt
    ),
    pharmacyCreatedAtIdx: index(
      'pharmacy_sales_returns_pharmacy_created_idx'
    ).on(table.pharmacyId, table.createdAt),
  })
);

export const PharmacySalesReturnItemsModel = pgTable(
  'pharmacy_sales_return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesReturnId: uuid('sales_return_id')
      .references(() => PharmacySalesReturnModel.id)
      .notNull(),
    salesItemId: uuid('sales_item_id')
      .references(() => PharmacySalesItemsModel.id)
      .notNull(),
    stockMedicineId: uuid('stock_medicine_id')
      .references(() => PharmacyStockMedicineModel.id)
      .notNull(),
    returnedQuantity: integer('returned_quantity').default(0).notNull(),
    refundAmount: decimal('refund_amount', {
      precision: 12,
      scale: 2,
    }).default('0'),
  },
  (table) => ({
    salesReturnIdIdx: index('pharmacy_sales_return_items_return_id_idx').on(
      table.salesReturnId
    ),
    salesItemIdIdx: index('pharmacy_sales_return_items_sales_item_id_idx').on(
      table.salesItemId
    ),
    stockMedicineIdIdx: index(
      'pharmacy_sales_return_items_stock_medicine_id_idx'
    ).on(table.stockMedicineId),
  })
);
