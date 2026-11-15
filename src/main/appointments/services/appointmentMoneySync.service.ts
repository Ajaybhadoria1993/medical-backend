import { and, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import type { MoneyMoveDto } from '../schemas/appointment.schemas';
import {
  MoneyWriteService,
  SYSTEM_ACTOR_ID,
  balanceOf,
  toPaise,
} from '../../money';
import logger from '../../../utils/logger';
import type { SourceBalance } from '../../money';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';
import { PaymentMode } from '../utils/paymentMode.constants';
import { APPOINTMENT_TYPE_TREATMENT } from '../utils/appointmentType.constants';
import { HttpError } from '../../../middlewear/errorHandler';
import type {
  DirectMove,
  LedgerKind,
  LedgerRow,
  MoneyMove,
  VisitCover,
} from '../types/appointmentMoney.types';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

/** Visits that never happened owe nothing, as in the dues figures. */
const NOT_ATTENDED = ['Cancelled', 'NoShow', 'No Show', 'Missed'];
const PRIMARY = 'primary';
/** An unpaid visit that never happened: nothing is owed, but nothing was paid either. */
const NOT_CHARGED = 'Not Charged';

/** Statuses that mean the visit owes its bill (paid or not yet). */
const OWING = [
  'paid',
  'refunded',
  'already paid',
  'partly paid',
  'partly refunded',
];
/** Statuses the ledger never overwrites: no bill, or an online checkout that never completed. */
const FIXED = ['free consultation', 'failed'];

/** An appointment's money: bill charge lines, direct payments and refunds, and the status cache.
 *  Money moves only as direct moves; charges follow the bill. */
export class AppointmentMoneySync {
  /** Charges follow the bill, then `move` (money the caller knows) is recorded once.
   *  No move: charges only; a payment status never becomes money (6c). */
  static async afterChange(
    tx: Tx,
    appointmentId: string,
    actorId: string,
    opts: { chargesOnly?: boolean; move?: DirectMove } = {}
  ) {
    await this.syncCharges(tx, appointmentId, actorId);
    await this.refreshStatus(tx, appointmentId);
    if (opts.move) return this.direct(tx, appointmentId, actorId, opts.move);
  }

  /** Records a known event once: a repeat (webhook resend, a second confirm path) or nothing left
   *  to pay or refund writes nothing, instead of failing the caller's transaction. */
  private static async direct(
    tx: Tx,
    appointmentId: string,
    actorId: string,
    m: DirectMove
  ) {
    const entries = await MoneyWriteService.entriesOf(
      tx,
      'appointment',
      appointmentId
    );
    if (entries.some((e) => e.requestId === m.requestId)) return;
    const b = await this.settle(tx, appointmentId, balanceOf(entries));
    const room = m.kind === 'pay' ? b.due : b.received;
    const amountPaise = Math.min(m.amountPaise ?? room, room);
    if (amountPaise <= 0) return;
    await this[m.kind](tx, { ...m, appointmentId, actorId, amountPaise });
  }

  /** The visit's balance and money entries, oldest first. */
  static async statement(appointmentId: string) {
    return database.transaction(async (tx) => {
      const entries = await MoneyWriteService.entriesOf(
        tx,
        'appointment',
        appointmentId
      );
      return {
        balance: await this.settle(tx, appointmentId, balanceOf(entries)),
        entries,
      };
    });
  }

  /** Desk collection or refund from the endpoints; returns the visit's new balance and entries. */
  static async move(
    kind: 'pay' | 'refund',
    appointmentId: string,
    body: MoneyMoveDto,
    actorId: string
  ) {
    const requestId = `appt:${appointmentId}:${body.requestId}`;
    return database.transaction(async (tx) => {
      const before = await MoneyWriteService.entriesOf(
        tx,
        'appointment',
        appointmentId
      );
      // A retried request returns what it already did instead of failing the due check.
      if (!before.some((e) => e.requestId === requestId))
        await this[kind](tx, {
          appointmentId,
          amountPaise:
            body.amount === undefined ? undefined : toPaise(body.amount),
          paymentMode: body.paymentMode,
          reason: body.reason,
          requestId,
          actorId,
        });
      const entries = await MoneyWriteService.entriesOf(
        tx,
        'appointment',
        appointmentId
      );
      return {
        balance: await this.settle(tx, appointmentId, balanceOf(entries)),
        entries,
      };
    });
  }

  /** Records money received; capped at what is due (no credit on appointments). */
  static async pay(tx: Tx, m: MoneyMove) {
    const visit = await this.visit(tx, m.appointmentId);
    const due = await this.balance(tx, m.appointmentId);
    const amount = m.amountPaise ?? due.due;
    if (amount <= 0)
      throw new HttpError(422, 'Nothing is due on this appointment');
    if (amount > due.due)
      throw new HttpError(
        422,
        `The most that can be paid now is ₹${(due.due / 100).toFixed(2)}`
      );
    await MoneyWriteService.record(tx, {
      ...visit,
      sourceType: 'appointment',
      sourceId: m.appointmentId,
      entryType: 'payment',
      capToDue: true,
      amountPaise: amount,
      paymentMode: m.paymentMode,
      channel: m.channel ?? 'desk',
      gatewayRef: m.gatewayRef ?? null,
      requestId: m.requestId,
      createdBy: m.actorId,
    });
    // A Pay Later visit now paid shows how it was paid, not "Pay Later".
    if (m.paymentMode)
      await tx
        .update(AppointmentPaymentModel)
        .set({ paymentMode: m.paymentMode, updatedAt: new Date() })
        .where(
          and(
            eq(AppointmentPaymentModel.appointmentId, m.appointmentId),
            sql`lower(coalesce(${AppointmentPaymentModel.paymentMode}, '')) in ('', 'pay later', 'pay_later', 'paylater')`
          )
        );
    await this.refreshStatus(tx, m.appointmentId);
  }

  /** Records money given back; MoneyWriteService caps it at what was received. */
  static async refund(tx: Tx, m: MoneyMove) {
    const visit = await this.visit(tx, m.appointmentId);
    const amount =
      m.amountPaise ?? (await this.balance(tx, m.appointmentId)).received;
    if (amount <= 0)
      throw new HttpError(422, 'Nothing was received on this appointment');
    await MoneyWriteService.record(tx, {
      ...visit,
      sourceType: 'appointment',
      sourceId: m.appointmentId,
      entryType: 'refund',
      amountPaise: amount,
      paymentMode: m.paymentMode,
      channel: m.channel ?? 'desk',
      gatewayRef: m.gatewayRef ?? null,
      requestId: m.requestId,
      reason: m.reason || 'Refund',
      createdBy: m.actorId,
    });
    await this.refreshStatus(tx, m.appointmentId);
  }

  /** Unpaid cancelled/no-show visits still marked Pending: takes their charge back and sets "Not Charged".
   *  Catches bulk status writes (auto no-show, clinic closed) and old rows; each visit in its own transaction. */
  static async settleUnattended(limit = 500): Promise<number> {
    const rows = await database
      .select({ id: AppointmentModel.id })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(
        and(
          // Enum values only: 'No Show' in NOT_ATTENDED isn't one, and Postgres rejects it in a query.
          inArray(AppointmentModel.appointmentStatus, [
            'Cancelled',
            'NoShow',
            'Missed',
          ]),
          sql`LOWER(${AppointmentPaymentModel.paymentStatus}) = 'pending'`
        )
      )
      .limit(limit);
    let done = 0;
    for (const { id } of rows) {
      try {
        await database.transaction((tx) =>
          this.afterChange(tx, id, SYSTEM_ACTOR_ID)
        );
        done += 1;
      } catch (err) {
        logger.error(
          `[AppointmentMoneySync] Could not settle visit ${id}`,
          err
        );
      }
    }
    return done;
  }

  /** The visit's payment status as a cache of its ledger balance. */
  static async refreshStatus(tx: Tx, appointmentId: string) {
    const [row] = await tx
      .select({
        status: AppointmentPaymentModel.paymentStatus,
        visit: AppointmentModel.appointmentStatus,
      })
      .from(AppointmentPaymentModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
      .limit(1);
    const current = (row?.status ?? '').toLowerCase();
    if (!row || FIXED.includes(current)) return;
    const b = await this.balance(tx, appointmentId);
    const unattended = NOT_ATTENDED.includes(row.visit ?? '');
    const next =
      b.refunded > 0
        ? b.received > 0
          ? 'Partly refunded'
          : 'Refunded'
        : b.charged === 0
          ? current === 'already paid'
            ? 'Already Paid'
            : b.received <= 0 &&
                (current === 'pending' || current === 'not charged')
              ? // A reinstated visit owes again; one that never happened owes nothing.
                unattended
                ? NOT_CHARGED
                : 'Pending'
              : row.status
          : b.received <= 0
            ? 'Pending'
            : b.due > 0
              ? 'Partly paid'
              : current === 'already paid'
                ? 'Already Paid'
                : 'Paid';
    if (next && next !== row.status)
      await tx
        .update(AppointmentPaymentModel)
        .set({ paymentStatus: next, updatedAt: new Date() })
        .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
  }

  /** A normal visit counted as a plan step: the plan now pays for it, so its own main charge goes.
   *  Returns what it was (for coveredReturn), or null when money was already taken on it (that payment settles the step). */
  static async coverByPlan(
    tx: Tx,
    appointmentId: string,
    actorId: string
  ): Promise<VisitCover | null> {
    const [row] = await tx
      .select({
        type: AppointmentModel.appointmentType,
        price: AppointmentPaymentModel.price,
        primary: AppointmentPaymentModel.primaryServicePrice,
        mode: AppointmentPaymentModel.paymentMode,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);
    if (!row || row.type === APPOINTMENT_TYPE_TREATMENT) return null;
    if ((await this.balance(tx, appointmentId)).received > 0) return null;
    await this.setCover(tx, appointmentId, actorId, {
      type: APPOINTMENT_TYPE_TREATMENT,
      price: '0',
      primary: '0',
      mode: PaymentMode.NOT_REQUIRED,
    });
    return row;
  }

  /** Undoes coverByPlan when the visit leaves the plan: its own price and payment mode come back. */
  static async coveredReturn(
    tx: Tx,
    appointmentId: string,
    actorId: string,
    was: VisitCover
  ) {
    await this.setCover(tx, appointmentId, actorId, was);
  }

  private static async setCover(
    tx: Tx,
    appointmentId: string,
    actorId: string,
    to: VisitCover
  ) {
    await tx
      .update(AppointmentModel)
      // appointment_type is NOT NULL, so a missing saved type leaves the visit's type as it is.
      .set({
        ...(to.type ? { appointmentType: to.type } : {}),
        updatedAt: new Date(),
      })
      .where(eq(AppointmentModel.id, appointmentId));
    await tx
      .update(AppointmentPaymentModel)
      .set({
        price: to.price,
        primaryServicePrice: to.primary,
        paymentMode: to.mode,
        updatedAt: new Date(),
      })
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
    await this.syncCharges(tx, appointmentId, actorId);
    await this.refreshStatus(tx, appointmentId);
  }

  static async balance(tx: Tx, appointmentId: string) {
    const entries = await MoneyWriteService.entriesOf(
      tx,
      'appointment',
      appointmentId
    );
    return this.settle(tx, appointmentId, balanceOf(entries));
  }

  /** A cancelled/no-show visit never owes more: refunding its money must not bring the bill back. */
  private static async settle(tx: Tx, appointmentId: string, b: SourceBalance) {
    if (b.due <= 0) return b;
    const [v] = await tx
      .select({ status: AppointmentModel.appointmentStatus })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);
    return NOT_ATTENDED.includes(v?.status ?? '') ? { ...b, due: 0 } : b;
  }

  private static async visit(tx: Tx, appointmentId: string) {
    const [v] = await tx
      .select({
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);
    if (!v?.patientId) throw new HttpError(404, 'Appointment not found');
    return {
      clinicId: v.clinicId,
      patientId: v.patientId,
      doctorId: v.doctorId,
    };
  }

  /** Charge lines follow the bill (primary + add-ons); safe to rerun. Returns entries written. */
  private static async syncCharges(
    tx: Tx,
    appointmentId: string,
    actorId: string
  ): Promise<number> {
    const [row] = await tx
      .select({
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
        appointmentStatus: AppointmentModel.appointmentStatus,
        status: AppointmentPaymentModel.paymentStatus,
        price: AppointmentPaymentModel.price,
        primary: AppointmentPaymentModel.primaryServicePrice,
      })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);
    if (!row?.patientId) return 0;

    // Same lock MoneyWriteService takes (re-entrant).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`money:appointment:${appointmentId}`}))`
    );

    const addons = await tx
      .select({
        serviceId: appointmentMultipleService.serviceId,
        price: appointmentMultipleService.price,
      })
      .from(appointmentMultipleService)
      .where(eq(appointmentMultipleService.appointmentId, appointmentId));
    const target = this.target(row, addons);

    const entries: LedgerRow[] = await MoneyWriteService.entriesOf(
      tx,
      'appointment',
      appointmentId
    );
    const common = {
      clinicId: row.clinicId,
      patientId: row.patientId,
      doctorId: row.doctorId,
      sourceType: 'appointment' as const,
      sourceId: appointmentId,
      createdBy: actorId,
    };
    let written = 0;

    const chargedNow = this.chargesByLine(entries);
    for (const [line, want] of target.charges) {
      const have = chargedNow.get(line) ?? 0;
      const lineRef = line === PRIMARY ? null : line;
      if (want > have) {
        await MoneyWriteService.record(tx, {
          ...common,
          lineRef,
          entryType: 'charge',
          amountPaise: want - have,
          channel: 'desk',
          requestId: `sync:${appointmentId}:charge:${line}:${have}>${want}`,
        });
        written++;
      } else if (want < have) {
        written += await this.takeBack(
          tx,
          entries,
          'charge',
          have - want,
          common,
          'desk',
          `${have}>${want}`,
          lineRef
        );
      }
    }

    return written;
  }

  private static target(
    row: {
      appointmentStatus: string | null;
      status: string | null;
      price: string | null;
      primary: string | null;
    },
    addons: { serviceId: string | null; price: string | null }[]
  ) {
    const status = (row.status ?? '').toLowerCase();
    const covered = status === 'already paid';
    const addonLines = new Map<string, number>();
    for (const a of addons) {
      const key = a.serviceId ?? PRIMARY;
      addonLines.set(key, (addonLines.get(key) ?? 0) + toPaise(a.price ?? 0));
    }
    const addonTotal = [...addonLines.values()].reduce((n, v) => n + v, 0);
    // revenueSql: a covered visit is its add-ons only; no primary price → `price` holds it all.
    const primaryLine = covered
      ? 0
      : row.primary == null
        ? Math.max(0, toPaise(row.price ?? 0) - addonTotal)
        : toPaise(row.primary);
    // "Not Charged" is a pending visit that didn't happen; if it's reinstated it owes again.
    const owes =
      OWING.includes(status) ||
      ((status === 'pending' || status === 'not charged') &&
        !NOT_ATTENDED.includes(row.appointmentStatus ?? ''));
    const charges = new Map<string, number>([
      [PRIMARY, owes ? primaryLine : 0],
    ]);
    for (const [k, v] of addonLines) charges.set(k, owes ? v : 0);
    return { charges };
  }

  private static chargesByLine(entries: LedgerRow[]) {
    const lineOf = new Map(entries.map((e) => [e.id, e.lineRef ?? PRIMARY]));
    const out = new Map<string, number>();
    for (const e of entries) {
      if (e.entryType === 'charge') {
        const k = e.lineRef ?? PRIMARY;
        out.set(k, (out.get(k) ?? 0) + e.amountPaise);
      } else if (e.entryType === 'adjustment' && e.reversesEntryId) {
        const target = entries.find((x) => x.id === e.reversesEntryId);
        if (target?.entryType === 'charge') {
          const k = lineOf.get(target.id)!;
          out.set(k, (out.get(k) ?? 0) - e.amountPaise);
        }
      }
    }
    return out;
  }

  /** A figure went down: adjust the newest entries of that kind and line. */
  private static async takeBack(
    tx: Tx,
    entries: LedgerRow[],
    kind: LedgerKind,
    amount: number,
    common: {
      clinicId: string;
      patientId: string;
      doctorId: string | null;
      sourceType: 'appointment';
      sourceId: string;
      createdBy: string;
    },
    channel: 'desk' | 'online',
    keyPart: string,
    lineRef: string | null
  ): Promise<number> {
    let left = amount;
    let written = 0;
    for (const e of [...entries].reverse()) {
      if (left <= 0) break;
      if (e.entryType !== kind) continue;
      if (kind === 'charge' && (e.lineRef ?? null) !== lineRef) continue;
      const undone = entries
        .filter((x) => x.reversesEntryId === e.id)
        .reduce((n, x) => n + x.amountPaise, 0);
      const take = Math.min(left, e.amountPaise - undone);
      if (take <= 0) continue;
      await MoneyWriteService.record(tx, {
        ...common,
        lineRef,
        entryType: 'adjustment',
        amountPaise: take,
        channel,
        reversesEntryId: e.id,
        // request_id is varchar(100): the reversed entry already names the visit and line, so one id is enough.
        requestId: `sync:${e.id}:${kind}-down:${keyPart}`,
        reason: 'Corrected to match the appointment',
      });
      left -= take;
      written++;
    }
    return written;
  }
}
