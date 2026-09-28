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
import { PharmacyStockModel } from './pharmacyStock.model';
import { PharmacyStockMedicineModel } from './pharmacyStockMedicine.model';

export const PharmacyPurchaseReturnModel = pgTable(
  'pharmacy_purchase_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    stockId: uuid('stock_id')
      .references(() => PharmacyStockModel.id)
      .notNull(),
    totalReturnAmount: decimal('total_return_amount', {
      precision: 12,
      scale: 2,
    }).default('0'),
    refundMethod: varchar('refund_method'),
    returnReason: varchar('return_reason', { length: 255 }).notNull(),
    refundNotes: varchar('refund_notes', { length: 500 }),
    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pharmacyIdIdx: index('pharmacy_purchase_returns_pharmacy_id_idx').on(
      table.pharmacyId
    ),
    stockIdIdx: index('pharmacy_purchase_returns_stock_id_idx').on(
      table.stockId
    ),
    createdByIdx: index('pharmacy_purchase_returns_created_by_idx').on(
      table.createdBy
    ),
    createdAtIdx: index('pharmacy_purchase_returns_created_at_idx').on(
      table.createdAt
    ),
    pharmacyCreatedAtIdx: index(
      'pharmacy_purchase_returns_pharmacy_created_idx'
    ).on(table.pharmacyId, table.createdAt),
  })
);

export const PharmacyPurchaseReturnItemsModel = pgTable(
  'pharmacy_purchase_return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseReturnId: uuid('purchase_return_id')
      .references(() => PharmacyPurchaseReturnModel.id)
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
    purchaseReturnIdIdx: index(
      'pharmacy_purchase_return_items_return_id_idx'
    ).on(table.purchaseReturnId),
    stockMedicineIdIdx: index(
      'pharmacy_purchase_return_items_stock_medicine_id_idx'
    ).on(table.stockMedicineId),
  })
);
