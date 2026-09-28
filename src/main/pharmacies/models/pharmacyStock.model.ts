import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  integer,
  decimal,
  index,
} from 'drizzle-orm/pg-core';
import { PharmacySupplierModel } from './pharmacySupplier.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';

export const pharmacyStockPaymentStatusEnum = pgEnum(
  'pharmacy_stock_payment_status',
  ['paid', 'unpaid', 'partial']
);

export const PharmacyStockModel = pgTable(
  'pharmacy_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    pharmacySupplierId: uuid('pharmacy_supplier_id').references(
      () => PharmacySupplierModel.id
    ),
    purchaseDate: timestamp('purchase_date').notNull(),
    invoice: varchar('invoice'),
    pharmacyStockPaymentStatus: pharmacyStockPaymentStatusEnum(
      'pharmacy_stock_payment_status'
    ).notNull(),
    paymentNotes: varchar('payment_notes', { length: 100 }),
    unit: integer('unit').default(0),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default(
      '0'
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pharmacyIdIdx: index('pharmacy_stock_pharmacy_id_idx').on(table.pharmacyId),
    purchaseDateIdx: index('pharmacy_stock_purchase_date_idx').on(
      table.purchaseDate
    ),
    pharmacyPaymentStatusIdx: index('pharmacy_stock_pharmacy_payment_idx').on(
      table.pharmacyId,
      table.pharmacyStockPaymentStatus
    ),
  })
);
