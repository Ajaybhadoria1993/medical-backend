import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import {
  MoneyEntryModel as Entry,
  type MoneyEntry,
} from '../models/moneyEntry.model';
import { ReceiptSequenceModel as Seq } from '../models/receiptSequence.model';
import {
  balanceOf,
  clinicSide,
  counterAccount,
  formatReceiptNo,
  isBalanced,
  netLines,
  oppositeSide,
  type EntryType,
  type JournalLine,
} from '../utils/money.utils';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

export interface RecordMoneyInput {
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
  sourceType: 'appointment' | 'treatment_plan';
  sourceId: string;
  lineRef?: string | null;
  entryType: EntryType;
  amountPaise: number;
  paymentMode?: string | null;
  channel: 'desk' | 'online';
  gatewayRef?: string | null;
  /** Gateway id for online money, the form's id for desk money. */
  requestId: string;
  reversesEntryId?: string | null;
  reason?: string | null;
  createdBy: string;
  /** Backfill only: keeps old money on its visit date. */
  occurredAt?: Date;
  /** Payment only: re-check "amount ≤ due" after the source lock, so two quick collects can't both pay. */
  capToDue?: boolean;
  approvedBy?: string | null;
}

/** A fee or payout journal; clinic money uses record() for its caps and receipts. */
export interface PostJournalInput {
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
  sourceType: RecordMoneyInput['sourceType'];
  sourceId: string;
  entryType: EntryType;
  channel: 'desk' | 'online';
  paymentMode?: string | null;
  gatewayRef?: string | null;
  requestId: string;
  reason?: string | null;
  createdBy: string;
  lines: JournalLine[];
}

const NEEDS_REASON: EntryType[] = ['refund', 'write_off', 'adjustment'];
// paid_at_visit has none: the visit's own payment already has the receipt.
const GETS_RECEIPT: EntryType[] = ['payment', 'refund', 'advance'];

/** The only writer of money; runs in the caller's transaction so both commit together. */
export class MoneyWriteService {
  /** Clinic money: the clinic line plus its counter line in one journal; returns the clinic line. */
  static async record(tx: Tx, input: RecordMoneyInput): Promise<MoneyEntry> {
    this.validate(input);

    // Double click or webhook resend: return the first entry.
    const repeat = await this.findByRequest(
      tx,
      input.clinicId,
      input.requestId
    );
    if (repeat) return repeat;

    // Serialise writers per source so the caps see every earlier entry.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`money:${input.sourceType}:${input.sourceId}`}))`
    );
    const again = await this.findByRequest(tx, input.clinicId, input.requestId);
    if (again) return again;

    const targetType = await this.checkCaps(tx, input);

    const receiptNo = GETS_RECEIPT.includes(input.entryType)
      ? await this.nextReceiptNo(tx, input.clinicId, input.occurredAt)
      : null;

    const journalId = randomUUID();
    const side = clinicSide(input.entryType, targetType);
    const shared = {
      journalId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      doctorId: input.doctorId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      lineRef: input.lineRef ?? null,
      entryType: input.entryType,
      amountPaise: input.amountPaise,
      paymentMode: input.paymentMode ?? null,
      channel: input.channel,
      gatewayRef: input.gatewayRef ?? null,
      requestId: input.requestId,
      reversesEntryId: input.reversesEntryId ?? null,
      reason: input.reason ?? null,
      approvedBy: input.approvedBy ?? null,
      createdBy: input.createdBy,
      ...(input.occurredAt ? { createdAt: input.occurredAt } : {}),
    };
    const rows = await tx
      .insert(Entry)
      .values([
        { ...shared, account: 'clinic' as const, side, receiptNo },
        {
          ...shared,
          account: counterAccount(input.entryType, input.channel, targetType),
          side: oppositeSide(side),
          receiptNo: null,
        },
      ])
      .returning();
    return rows.find((r) => r.account === 'clinic')!;
  }

  /** Writes a balanced fee or payout journal; a retry returns the first lines. */
  static async post(tx: Tx, input: PostJournalInput): Promise<MoneyEntry[]> {
    const lines = netLines(input.lines);
    if (lines.some((l) => l.account === 'clinic'))
      throw new Error('Clinic money goes through MoneyWriteService.record');
    if (!isBalanced(lines))
      throw new Error(`Journal ${input.requestId} does not balance`);

    const repeat = await this.journalOf(tx, input.clinicId, input.requestId);
    if (repeat.length) return repeat;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`money:journal:${input.clinicId}:${input.requestId}`}))`
    );
    const again = await this.journalOf(tx, input.clinicId, input.requestId);
    if (again.length) return again;

    const journalId = randomUUID();
    return tx
      .insert(Entry)
      .values(
        lines.map((l) => ({
          journalId,
          account: l.account,
          side: l.side,
          amountPaise: l.amountPaise,
          clinicId: input.clinicId,
          patientId: input.patientId,
          doctorId: input.doctorId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          entryType: input.entryType,
          paymentMode: input.paymentMode ?? null,
          channel: input.channel,
          gatewayRef: input.gatewayRef ?? null,
          requestId: input.requestId,
          reason: input.reason ?? null,
          createdBy: input.createdBy,
        }))
      )
      .returning();
  }

  /** Every line a request already wrote (non-clinic journals). */
  private static journalOf(tx: Tx, clinicId: string, requestId: string) {
    return tx
      .select()
      .from(Entry)
      .where(and(eq(Entry.clinicId, clinicId), eq(Entry.requestId, requestId)));
  }

  /** A source's clinic lines, oldest first (counter and fee lines left out). */
  static entriesOf(
    tx: Tx | typeof database,
    sourceType: RecordMoneyInput['sourceType'],
    sourceId: string
  ) {
    return tx
      .select()
      .from(Entry)
      .where(
        and(
          eq(Entry.sourceType, sourceType),
          eq(Entry.sourceId, sourceId),
          eq(Entry.account, 'clinic')
        )
      )
      .orderBy(Entry.createdAt);
  }

  /** Rejects an amount, reason or gateway reference the entry type needs. */
  private static validate(input: RecordMoneyInput) {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
      throw new HttpError(422, 'Enter an amount above zero');
    if (NEEDS_REASON.includes(input.entryType) && !input.reason?.trim())
      throw new HttpError(422, 'Give a reason');
    if (input.entryType === 'adjustment' && !input.reversesEntryId)
      throw new HttpError(422, 'An adjustment must name the entry it corrects');
    if (
      input.channel === 'online' &&
      GETS_RECEIPT.includes(input.entryType) &&
      !input.gatewayRef
    )
      throw new HttpError(422, 'Online money needs its gateway reference');
  }

  /** Refund ≤ received, write-off ≤ due, adjustment ≤ what is left of its entry, capped payment ≤ due.
   *  Returns an adjustment's target type, which sets its sides. */
  private static async checkCaps(
    tx: Tx,
    input: RecordMoneyInput
  ): Promise<EntryType | undefined> {
    const cappedPayment = input.entryType === 'payment' && input.capToDue;
    if (
      !cappedPayment &&
      !['refund', 'write_off', 'adjustment'].includes(input.entryType)
    )
      return undefined;
    const rows = await this.entriesOf(tx, input.sourceType, input.sourceId);
    const balance = balanceOf(
      rows.map((r) => ({
        id: r.id,
        entryType: r.entryType,
        amountPaise: r.amountPaise,
        reversesEntryId: r.reversesEntryId,
      }))
    );
    if (cappedPayment && input.amountPaise > balance.due)
      throw new HttpError(
        409,
        `This visit has ${balance.due > 0 ? `only ₹${(balance.due / 100).toFixed(2)} left to pay` : 'nothing left to pay'}; it may have just been collected`
      );
    if (input.entryType === 'refund' && input.amountPaise > balance.received)
      throw new HttpError(
        422,
        `A refund can't be more than what was paid (₹${(balance.received / 100).toFixed(2)})`
      );
    if (input.entryType === 'write_off' && input.amountPaise > balance.due)
      throw new HttpError(
        422,
        `Only what is owed can be written off (₹${(Math.max(0, balance.due) / 100).toFixed(2)})`
      );
    if (input.entryType === 'adjustment') {
      const target = rows.find((r) => r.id === input.reversesEntryId);
      if (!target || target.entryType === 'adjustment')
        throw new HttpError(
          422,
          'The entry to correct was not found on this record'
        );
      const undone = rows
        .filter((r) => r.reversesEntryId === target.id)
        .reduce((n, r) => n + r.amountPaise, 0);
      if (input.amountPaise > target.amountPaise - undone)
        throw new HttpError(
          422,
          'This correction is more than what is left of the entry'
        );
      return target.entryType;
    }
    return undefined;
  }

  /** The entry a request already made, if any: callers use it to answer a retry with the first result. */
  static async findByRequest(
    tx: Tx | typeof database,
    clinicId: string,
    requestId: string
  ) {
    const [row] = await tx
      .select()
      .from(Entry)
      .where(
        and(
          eq(Entry.clinicId, clinicId),
          eq(Entry.requestId, requestId),
          eq(Entry.account, 'clinic')
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** One receipt series per clinic and IST year; the upsert's row lock keeps it unique. */
  private static async nextReceiptNo(
    tx: Tx,
    clinicId: string,
    occurredAt?: Date
  ) {
    const year = Number(getISTDateString(occurredAt).slice(0, 4));
    const [row] = await tx
      .insert(Seq)
      .values({ clinicId, year, lastNo: 1 })
      .onConflictDoUpdate({
        target: [Seq.clinicId, Seq.year],
        set: { lastNo: sql`${Seq.lastNo} + 1` },
      })
      .returning({ lastNo: Seq.lastNo });
    return formatReceiptNo(year, row.lastNo);
  }
}
