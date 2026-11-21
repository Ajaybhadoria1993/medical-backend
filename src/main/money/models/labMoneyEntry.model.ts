import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { LabsModel } from '../../lab/models/lab.model';
import {
  LAB_MONEY_SOURCES,
  moneyChannelEnum,
  moneyEntryTypeEnum,
} from './moneyEntry.model';

export const labMoneySourceEnum = pgEnum('lab_money_source', LAB_MONEY_SOURCES);

/** Lab money, one row per payment record and edited in place, so it stays out of the add-only clinic ledger. */
export const LabMoneyEntryModel = pgTable(
  'lab_money_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    labId: uuid('lab_id')
      .references(() => LabsModel.id, { onDelete: 'restrict' })
      .notNull(),
    patientId: uuid('patient_id'),
    sourceType: labMoneySourceEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    entryType: moneyEntryTypeEnum('entry_type').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    paymentMode: varchar('payment_mode', { length: 20 }),
    channel: moneyChannelEnum('channel').notNull(),
    /** L-YYYY-NNNNNN, one series per lab per year. */
    receiptNo: varchar('receipt_no', { length: 30 }),
    reason: varchar('reason', { length: 255 }),
    paymentNotes: varchar('payment_notes', { length: 50 }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('lab_money_entries_source_idx').on(t.sourceType, t.sourceId),
    index('lab_money_entries_lab_created_idx').on(t.labId, t.createdAt),
    uniqueIndex('lab_money_entries_receipt_uq')
      .on(t.labId, t.receiptNo)
      .where(sql`${t.receiptNo} IS NOT NULL`),
    // ₹0 is allowed: a test can be billed at zero.
    check('lab_money_entries_amount_ck', sql`${t.amountPaise} >= 0`),
    check(
      'lab_money_entries_type_ck',
      sql`${t.entryType}::text IN ('charge', 'payment', 'refund')`
    ),
  ]
);
