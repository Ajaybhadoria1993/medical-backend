import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  decimal,
  date,
} from 'drizzle-orm/pg-core';

export const HsnTaxMasterModel = pgTable(
  'hsn_tax_master',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hsnCode: varchar('hsn_code', { length: 8 }).notNull(),
    gstPercentage: decimal('gst_percentage', {
      precision: 5,
      scale: 2,
    }).notNull(),
    description: varchar('description', { length: 255 }),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueHsnEffective: uniqueIndex('uq_hsn_effective').on(
      table.hsnCode,
      table.effectiveFrom
    ),
    hsnIndex: index('idx_hsn_code').on(table.hsnCode),
  })
);
