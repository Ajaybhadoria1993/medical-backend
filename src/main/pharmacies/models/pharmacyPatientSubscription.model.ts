import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { PharmacySalesModel } from './pharmacySales.model';
import { pharmacyMedicineModel } from './pharmacyMedicine.model';
import { UserModel } from '../../users/models';

export const subscriptionStatusEnum = pgEnum('pharmacy_subscription_status', [
  'active',
  'paused',
  'cancelled',
]);

export const pharmacyPatientSubscriptionModel = pgTable(
  'pharmacy_patient_subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id')
      .references(() => PharmacyModel.id)
      .notNull(),
    customerId: uuid('customer_id').references(() => UserModel.id),
    customerName: varchar('customer_name', { length: 50 }),
    customerMobile: varchar('customer_mobile', { length: 15 }),
    customerAddress: varchar('customer_address', { length: 100 }),
    frequencyDays: integer('frequency_days').notNull(),
    nextDeliveryDate: timestamp('next_delivery_date').notNull(),
    status: subscriptionStatusEnum('status').default('active').notNull(),
    remarks: varchar('remarks', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pharmacyIdIdx: index('pharmacy_subscription_pharmacy_id_idx').on(
      table.pharmacyId
    ),
    customerMobileIdx: index('pharmacy_subscription_mobile_idx').on(
      table.customerMobile
    ),
    nextDeliveryDateIdx: index('pharmacy_subscription_delivery_idx').on(
      table.nextDeliveryDate
    ),
  })
);

export const pharmacySubscriptionMedicineModel = pgTable(
  'pharmacy_subscription_medicines',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    pharmacyPatientSubscriptionId: uuid('pharmacy_patient_subscription_id')
      .references(() => pharmacyPatientSubscriptionModel.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    pharmacyMedicineId: uuid('pharmacy_medicine_id')
      .references(() => pharmacyMedicineModel.id)
      .notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index('subscription_medicine_subscription_idx').on(
      table.pharmacyPatientSubscriptionId
    ),

    medicineIdx: index('subscription_medicine_medicine_idx').on(
      table.pharmacyMedicineId
    ),
  })
);

export const pharmacySubscriptionSalesMapModel = pgTable(
  'pharmacy_subscription_sales_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyPatientSubscriptionId: uuid('pharmacy_patient_subscription_id')
      .references(() => pharmacyPatientSubscriptionModel.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    pharmacySalesId: uuid('pharmacy_sales_id')
      .references(() => PharmacySalesModel.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    subscriptionIdx: index('subscription_sales_subscription_idx').on(
      table.pharmacyPatientSubscriptionId
    ),

    salesIdx: index('subscription_sales_sales_idx').on(table.pharmacySalesId),
  })
);
