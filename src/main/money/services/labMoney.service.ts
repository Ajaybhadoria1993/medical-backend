import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { getISTDateString } from '../../../utils/istDateTime';
import { MoneyEntryModel as Entry } from '../models/moneyEntry.model';
import { LabReceiptSequenceModel as LabSeq } from '../models/receiptSequence.model';
import { formatLabReceiptNo, toPaise } from '../utils/money.utils';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

export type LabMoneySource = 'lab_test' | 'lab_home_collection';
/** What a caller may set on a payment row. */
export type LabPaymentStatus = 'pending' | 'paid' | 'failed';
/** What a stored row reads as; a refund is its own row. */
export type LabRowStatus = LabPaymentStatus | 'refunded';

export interface LabMoneyRow {
  id: string;
  sourceId: string;
  price: number;
  paymentStatus: LabRowStatus;
  paymentMode: string | null;
  paymentNotes: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface LabMoneyInsert {
  sourceType: LabMoneySource;
  sourceId: string;
  labId: string;
  patientId: string | null;
  price?: number | null;
  paymentStatus: LabPaymentStatus;
  paymentMode?: string | null;
  paymentNotes?: string | null;
  createdBy: string;
  createdAt?: Date;
}

export interface LabMoneyChanges {
  price?: number | null;
  paymentStatus?: LabPaymentStatus;
  paymentMode?: string | null;
  paymentNotes?: string | null;
}

export interface LabRefundInsert {
  sourceType: LabMoneySource;
  sourceId: string;
  labId: string;
  patientId: string | null;
  amount: number;
  reason: string;
  paymentMode?: string | null;
  paymentNotes?: string | null;
  createdBy: string;
}

// Paid money is a payment; pending and failed are a charge still owed, a failed one marked by its reason.
const FAILED_REASON = 'Payment failed';

const toEntry = (status: LabPaymentStatus) =>
  status === 'paid'
    ? { entryType: 'payment' as const, reason: null }
    : {
        entryType: 'charge' as const,
        reason: status === 'failed' ? FAILED_REASON : null,
      };

const toStatus = (entryType: string, reason: string | null): LabRowStatus =>
  entryType === 'refund'
    ? 'refunded'
    : entryType === 'payment'
      ? 'paid'
      : reason === FAILED_REASON
        ? 'failed'
        : 'pending';

const COLUMNS = {
  id: Entry.id,
  sourceId: Entry.sourceId,
  amountPaise: Entry.amountPaise,
  entryType: Entry.entryType,
  reason: Entry.reason,
  receiptNo: Entry.receiptNo,
  paymentMode: Entry.paymentMode,
  paymentNotes: Entry.paymentNotes,
  createdAt: Entry.createdAt,
};

type StoredRow = {
  id: string;
  sourceId: string;
  amountPaise: number;
  entryType: string;
  reason: string | null;
  receiptNo: string | null;
  paymentMode: string | null;
  paymentNotes: string | null;
  createdAt: Date;
};

const toRow = (r: StoredRow): LabMoneyRow => ({
  id: r.id,
  sourceId: r.sourceId,
  price: r.amountPaise / 100,
  paymentStatus: toStatus(r.entryType, r.reason),
  paymentMode: r.paymentMode,
  paymentNotes: r.paymentNotes,
  reason: r.reason,
  createdAt: r.createdAt,
});

const STATUS_SQL = sql.raw(`CASE
  WHEN lab_money.entry_type = 'payment' THEN 'paid'
  WHEN lab_money.reason = '${FAILED_REASON}' THEN 'failed'
  ELSE 'pending' END`);

/** Lab money in money_entries: one row per lab payment record, kept in step in place (unlike clinic rows). */
export class LabMoneyService {
  /** Correlated columns for a query over the source's own table (`outerId` is its id column). */
  static columns(sourceType: LabMoneySource, outerId: SQL) {
    // A closed set of literals, never caller input; inlined so it compares as the enum.
    const source = sql.raw(`'${sourceType}'`);
    const where = sql`lab_money.source_type = ${source} AND lab_money.source_id = ${outerId}`;
    // Refunds are their own rows; the payment record they leave alone is what reads as "latest".
    const latest = (field: SQL) => sql`(
      SELECT ${field} FROM money_entries lab_money
      WHERE ${where} AND lab_money.entry_type <> 'refund'
      ORDER BY lab_money.created_at DESC, lab_money.id DESC
      LIMIT 1
    )`;
    const sumOf = (types: string) => sql`(
      SELECT COALESCE(SUM(lab_money.amount_paise), 0) FROM money_entries lab_money
      WHERE ${where} AND lab_money.entry_type::text IN (${sql.raw(types)})
    )`;
    const refunded = sumOf(`'refund'`);
    return {
      price: sql<number | null>`(
        SELECT (SUM(lab_money.amount_paise) / 100)::int FROM money_entries lab_money
        WHERE ${where} AND lab_money.entry_type <> 'refund'
      )`,
      paymentStatus: sql<string>`CASE
        WHEN ${refunded} > 0 AND ${refunded} >= ${sumOf(`'payment'`)} THEN 'refunded'
        ELSE COALESCE(${latest(STATUS_SQL)}, 'pending') END`,
      paymentMode: sql<
        string | null
      >`${latest(sql.raw('lab_money.payment_mode'))}`,
      paymentNotes: sql<
        string | null
      >`${latest(sql.raw('lab_money.payment_notes'))}`,
      refundedAmount: sql<number>`(${refunded} / 100)::int`,
    };
  }

  static async insert(tx: Tx, input: LabMoneyInsert): Promise<LabMoneyRow> {
    const { entryType, reason } = toEntry(input.paymentStatus);
    const createdAt = input.createdAt ?? new Date();
    const [row] = await tx
      .insert(Entry)
      .values({
        clinicId: null,
        patientId: input.patientId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        entryType,
        reason,
        amountPaise: toPaise(input.price ?? 0),
        paymentMode: input.paymentMode ?? null,
        paymentNotes: input.paymentNotes ?? null,
        channel: 'desk',
        receiptNo:
          entryType === 'payment'
            ? await this.nextReceiptNo(tx, input.labId, createdAt)
            : null,
        requestId: null,
        gatewayRef: null,
        createdBy: input.createdBy,
        createdAt,
      })
      .returning(COLUMNS);
    return toRow(row);
  }

  static async update(
    tx: Tx,
    entryId: string,
    labId: string,
    changes: LabMoneyChanges
  ): Promise<LabMoneyRow | null> {
    const [current] = await tx
      .select(COLUMNS)
      .from(Entry)
      .where(eq(Entry.id, entryId))
      .limit(1);
    if (!current) return null;

    const status = changes.paymentStatus
      ? toEntry(changes.paymentStatus)
      : undefined;
    // A charge settled later gets its receipt then; a receipt once issued is never reused.
    const needsReceipt = status?.entryType === 'payment' && !current.receiptNo;
    const [row] = await tx
      .update(Entry)
      .set({
        ...(changes.price !== undefined
          ? { amountPaise: toPaise(changes.price ?? 0) }
          : {}),
        ...(status
          ? { entryType: status.entryType, reason: status.reason }
          : {}),
        ...(changes.paymentMode !== undefined
          ? { paymentMode: changes.paymentMode }
          : {}),
        ...(changes.paymentNotes !== undefined
          ? { paymentNotes: changes.paymentNotes }
          : {}),
        ...(needsReceipt
          ? { receiptNo: await this.nextReceiptNo(tx, labId, new Date()) }
          : {}),
      })
      .where(eq(Entry.id, entryId))
      .returning(COLUMNS);
    return row ? toRow(row) : null;
  }

  /** The latest payment record; refunds never count as one. */
  static async latest(
    tx: Tx,
    sourceType: LabMoneySource,
    sourceId: string
  ): Promise<(LabMoneyRow & { paymentStatus: LabPaymentStatus }) | null> {
    const [row] = await tx
      .select(COLUMNS)
      .from(Entry)
      .where(
        and(
          eq(Entry.sourceType, sourceType),
          eq(Entry.sourceId, sourceId),
          ne(Entry.entryType, 'refund')
        )
      )
      .orderBy(desc(Entry.createdAt), desc(Entry.id))
      .limit(1);
    return row
      ? (toRow(row) as LabMoneyRow & { paymentStatus: LabPaymentStatus })
      : null;
  }

  /** Every row, refunds included, oldest first. */
  static async list(
    tx: Tx,
    sourceType: LabMoneySource,
    sourceIds: string[]
  ): Promise<LabMoneyRow[]> {
    if (sourceIds.length === 0) return [];
    const rows = await tx
      .select(COLUMNS)
      .from(Entry)
      .where(
        and(
          eq(Entry.sourceType, sourceType),
          inArray(Entry.sourceId, sourceIds)
        )
      )
      .orderBy(asc(Entry.createdAt), asc(Entry.id));
    return rows.map(toRow);
  }

  /** Refund rows only, in rupees, for totals that net them off. */
  static async refunds(
    tx: Tx,
    sourceType: LabMoneySource,
    sourceIds: string[]
  ): Promise<
    { sourceId: string; amount: number; paymentMode: string | null }[]
  > {
    if (sourceIds.length === 0) return [];
    const rows = await tx
      .select({
        sourceId: Entry.sourceId,
        amountPaise: Entry.amountPaise,
        paymentMode: Entry.paymentMode,
      })
      .from(Entry)
      .where(
        and(
          eq(Entry.sourceType, sourceType),
          inArray(Entry.sourceId, sourceIds),
          eq(Entry.entryType, 'refund')
        )
      );
    return rows.map((r) => ({
      sourceId: r.sourceId,
      amount: r.amountPaise / 100,
      paymentMode: r.paymentMode,
    }));
  }

  /** Serialises refunds on one item, so a double click cannot refund it twice. */
  static async lock(tx: Tx, sourceType: LabMoneySource, sourceId: string) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-refund:${sourceType}:${sourceId}`}))`
    );
  }

  /** Paid and not yet refunded, in rupees. Call under lock() before refunding. */
  static async refundable(
    tx: Tx,
    sourceType: LabMoneySource,
    sourceId: string
  ): Promise<number> {
    const [row] = await tx
      .select({
        paise: sql<number>`(COALESCE(SUM(CASE
          WHEN ${Entry.entryType} = 'payment' THEN ${Entry.amountPaise}
          WHEN ${Entry.entryType} = 'refund' THEN -${Entry.amountPaise}
          ELSE 0 END), 0))::bigint`,
      })
      .from(Entry)
      .where(
        and(eq(Entry.sourceType, sourceType), eq(Entry.sourceId, sourceId))
      );
    return Math.max(0, Number(row?.paise ?? 0)) / 100;
  }

  static async refund(tx: Tx, input: LabRefundInsert): Promise<LabMoneyRow> {
    const createdAt = new Date();
    const [row] = await tx
      .insert(Entry)
      .values({
        clinicId: null,
        patientId: input.patientId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        entryType: 'refund',
        reason: input.reason,
        amountPaise: toPaise(input.amount),
        paymentMode: input.paymentMode ?? null,
        paymentNotes: input.paymentNotes ?? null,
        channel: 'desk',
        receiptNo: await this.nextReceiptNo(tx, input.labId, createdAt),
        requestId: null,
        gatewayRef: null,
        createdBy: input.createdBy,
        createdAt,
      })
      .returning(COLUMNS);
    return toRow(row);
  }

  private static async nextReceiptNo(tx: Tx, labId: string, at: Date) {
    const year = Number(getISTDateString(at).slice(0, 4));
    const [row] = await tx
      .insert(LabSeq)
      .values({ labId, year, lastNo: 1 })
      .onConflictDoUpdate({
        target: [LabSeq.labId, LabSeq.year],
        set: { lastNo: sql`${LabSeq.lastNo} + 1` },
      })
      .returning({ lastNo: LabSeq.lastNo });
    return formatLabReceiptNo(year, row.lastNo);
  }
}
