import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { ClinicModel } from '../../clinic/models/clinic.model';

/** Where the money belongs. Pharmacy joins later as a new value. */
export const moneySourceEnum = pgEnum('money_source', [
  'appointment',
  'treatment_plan',
  'lab_test',
  'lab_home_collection',
]);

/** Lab rows carry no clinic, so the clinic ledger readers (all scoped by clinic_id) never see them. */
export const LAB_MONEY_SOURCES = ['lab_test', 'lab_home_collection'] as const;

/** Amount is always positive; the type gives the direction. An adjustment undoes its target entry.
 *  Plans add an advance (paid before any visit) and paid_at_visit (the visit's own receipt settles the step). */
export const moneyEntryTypeEnum = pgEnum('money_entry_type', [
  'charge',
  'payment',
  'refund',
  'write_off',
  'adjustment',
  'advance',
  'paid_at_visit',
]);

export const moneyChannelEnum = pgEnum('money_channel', ['desk', 'online']);

/** Only `clinic` lines are the clinic's money; every other account balances a journal. */
export const moneyAccountEnum = pgEnum('money_account', [
  'clinic',
  'patient_receivable',
  'desk_cash',
  'gateway_clearing',
  'clinic_fees',
  'convenience_fee',
  'platform_commission',
  'gst_on_platform_fees',
  'pg_fee',
  'route_fee',
  'clinic_output_gst',
  'clinic_payout',
  'platform_payout',
]);

export const moneySideEnum = pgEnum('money_side', ['debit', 'credit']);

export type MoneyEntry = InferSelectModel<typeof MoneyEntryModel>;
export type NewMoneyEntry = InferInsertModel<typeof MoneyEntryModel>;

/** Append-only double-entry ledger; clinic money readers filter `account = 'clinic'`. */
export const MoneyEntryModel = pgTable(
  'money_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Groups one event's lines; debits = credits per journal (DB trigger). */
    journalId: uuid('journal_id').notNull(),
    account: moneyAccountEnum('account').notNull(),
    side: moneySideEnum('side').notNull(),
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'restrict' })
      .notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id'),

    sourceType: moneySourceEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** Optional finer line: an added service id, a plan step id. */
    lineRef: uuid('line_ref'),

    entryType: moneyEntryTypeEnum('entry_type').notNull(),
    /** Positive; clinic lines take direction from entry_type, other lines from side. */
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),

    paymentMode: varchar('payment_mode', { length: 20 }),
    channel: moneyChannelEnum('channel').notNull(),
    /** R-YYYY-NNNNNN, one series per clinic per year. */
    receiptNo: varchar('receipt_no', { length: 30 }),
    /** Razorpay payment / refund / transfer id. */
    gatewayRef: varchar('gateway_ref', { length: 255 }),

    /** A retry with the same id returns the first journal. */
    requestId: varchar('request_id', { length: 100 }).notNull(),
    reversesEntryId: uuid('reverses_entry_id').references(
      (): AnyPgColumn => MoneyEntryModel.id,
      { onDelete: 'restrict' }
    ),

    reason: varchar('reason', { length: 255 }),
    paymentNotes: varchar('payment_notes', { length: 50 }),
    /** Who approved it (a treatment plan write-off). */
    approvedBy: uuid('approved_by'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('money_entries_request_uq').on(
      t.clinicId,
      t.requestId,
      t.account
    ),
    index('money_entries_journal_idx').on(t.journalId),
    uniqueIndex('money_entries_receipt_uq')
      .on(t.clinicId, t.receiptNo)
      .where(sql`${t.receiptNo} IS NOT NULL`),
    index('money_entries_clinic_created_idx').on(t.clinicId, t.createdAt),
    index('money_entries_source_idx').on(t.sourceType, t.sourceId),
    index('money_entries_patient_idx').on(t.clinicId, t.patientId),
    index('money_entries_doctor_idx').on(t.clinicId, t.doctorId, t.createdAt),
    index('money_entries_gateway_idx').on(t.gatewayRef),
    // Lab rows may be ₹0 (a test billed at zero); ::text keeps the new enum values unused in the migration.
    check(
      'money_entries_amount_ck',
      sql`${t.amountPaise} > 0 OR (${t.sourceType}::text IN ('lab_test', 'lab_home_collection') AND ${t.amountPaise} >= 0)`
    ),
    check(
      'money_entries_reason_ck',
      sql`${t.account} <> 'clinic' OR ${t.entryType}::text IN ('charge', 'payment', 'advance', 'paid_at_visit') OR ${t.reason} IS NOT NULL`
    ),
    check(
      'money_entries_adjustment_ck',
      sql`${t.entryType} <> 'adjustment' OR ${t.reversesEntryId} IS NOT NULL`
    ),
    check(
      'money_entries_online_ref_ck',
      sql`${t.account} <> 'clinic' OR ${t.channel} = 'desk' OR ${t.entryType} NOT IN ('payment', 'refund') OR ${t.gatewayRef} IS NOT NULL`
    ),
  ]
);
