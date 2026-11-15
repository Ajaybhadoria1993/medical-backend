import { and, eq, inArray, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { CacheKeys } from '../../../utils/cache.util';
import logger from '../../../utils/logger';
import { listRazorpayAll } from '../../../utils/razorpay';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { AppointmentMoneySync } from '../../appointments/services/appointmentMoneySync.service';
import { SYSTEM_ACTOR_ID } from '../../money';
import {
  OnlineFeeLedger,
  PaymentIntentModel,
  PaymentTransactionModel,
  type ISplitBreakdown,
} from '../../payment';
import {
  FINDING_LABEL,
  matchAppointmentPayments,
  type Finding,
  type RzpPayment,
  type RzpRefund,
  type VisitMoney,
} from '../utils/appointmentPaymentMatch.utils';

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 3;
const HANDOFF_TTL_SEC = 26 * 60 * 60;

type Visit = VisitMoney & {
  clinicId: string;
  patientId: string;
  doctorId: string | null;
  snapshot: ISplitBreakdown | null;
};

/** Nightly: compares appointment payments with Razorpay, fixes the safe cases, lists the rest. */
export class AppointmentPaymentMatch {
  /** Runs the check over the last 3 days and returns the System jobs summary. */
  static async run(now = new Date()): Promise<string> {
    const from = new Date(now.getTime() - WINDOW_DAYS * DAY);
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    // Refunds from a day earlier, so one made just before the window still matches our row.
    const [all, refunds] = await Promise.all([
      listRazorpayAll<RzpPayment>('payments', sec(from), sec(now)),
      listRazorpayAll<RzpRefund>('refunds', sec(from) - DAY / 1000, sec(now)),
    ]);
    const ours = await this.appointmentOrders(
      all.map((p) => p.order_id).filter((o): o is string => !!o)
    );
    const payments = all.filter((p) => p.order_id && ours.has(p.order_id));
    const visits = await this.visits(payments);
    const findings = matchAppointmentPayments(
      payments,
      refunds,
      visits,
      await this.ourOnlineRefunds(from)
    );

    let fixed = 0;
    const needsLook: Finding[] = [];
    for (const f of findings) {
      const v = [...visits.values()].find(
        (x) => x.appointmentId === f.appointmentId
      );
      if (!f.fixable || !v) {
        needsLook.push(f);
        continue;
      }
      try {
        await this.fix(f, v);
        fixed++;
      } catch (err) {
        logger.error(`[AppointmentPaymentMatch] Fix failed for ${f.ref}`, err);
        needsLook.push({ ...f, fixable: false });
      }
    }

    const lines = needsLook.map((f) => `${f.ref}: ${FINDING_LABEL[f.kind]}`);
    await this.handOff(lines);
    if (lines.length)
      logger.warn(
        `[AppointmentPaymentMatch] Needs a look: ${lines.join('; ')}`
      );
    return `${payments.length} checked · ${fixed} fixed · ${needsLook.length} need a look${lines.length ? `: ${lines.slice(0, 5).join(', ')}` : ''}`;
  }

  /** Orders our appointment checkout created; other Razorpay payments (subscriptions) are left out. */
  private static async appointmentOrders(orderIds: string[]) {
    if (!orderIds.length) return new Set<string>();
    const rows = await database
      .select({ orderId: PaymentTransactionModel.gatewayOrderId })
      .from(PaymentTransactionModel)
      .innerJoin(
        PaymentIntentModel,
        eq(PaymentIntentModel.id, PaymentTransactionModel.paymentIntentId)
      )
      .where(
        and(
          eq(PaymentIntentModel.sourceType, 'APPOINTMENT'),
          inArray(PaymentTransactionModel.gatewayOrderId, orderIds)
        )
      );
    return new Set(rows.map((r) => r.orderId));
  }

  /** Each paid order's visit with its money from the ledger, keyed by Razorpay order id. */
  private static async visits(payments: RzpPayment[]) {
    const out = new Map<string, Visit>();
    const orderIds = payments.map((p) => p.order_id!);
    if (!orderIds.length) return out;
    const rows = await database
      .select({
        orderId: AppointmentPaymentModel.gatewayOrderId,
        appointmentId: AppointmentPaymentModel.appointmentId,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
        snapshot: AppointmentPaymentModel.financialSnapshot,
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
      })
      .from(AppointmentPaymentModel)
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(inArray(AppointmentPaymentModel.gatewayOrderId, orderIds));
    if (!rows.length) return out;

    const paymentIds = payments.map((p) => p.id);
    const byPayment = (await database.execute(sql`
      SELECT gateway_ref,
        SUM(amount_paise) FILTER (WHERE account = 'clinic' AND entry_type = 'payment') AS paid,
        SUM(amount_paise) FILTER (WHERE account = 'gateway_clearing' AND side = 'debit'
          AND request_id LIKE 'razorpay:fees:%') AS fee
      FROM money_entries
      WHERE gateway_ref IN (${sql.join(
        paymentIds.map((id) => sql`${id}`),
        sql`, `
      )})
      GROUP BY 1`)) as unknown as {
      gateway_ref: string;
      paid: string | null;
      fee: string | null;
    }[];
    const visitIds = rows.map((r) => r.appointmentId!);
    const refunded = (await database.execute(sql`
      SELECT source_id, SUM(amount_paise) AS paise FROM money_entries
      WHERE account = 'clinic' AND entry_type = 'refund' AND channel = 'online'
        AND source_type = 'appointment'
        AND source_id IN (${sql.join(
          visitIds.map((id) => sql`${id}`),
          sql`, `
        )})
      GROUP BY 1`)) as unknown as { source_id: string; paise: string }[];

    for (const r of rows) {
      const p = payments.find((x) => x.order_id === r.orderId);
      const m = byPayment.find((x) => x.gateway_ref === p?.id);
      out.set(r.orderId!, {
        appointmentId: r.appointmentId!,
        paymentStatus: r.paymentStatus,
        snapshot: (r.snapshot as ISplitBreakdown | null) ?? null,
        hasSnapshot: !!r.snapshot,
        clinicId: r.clinicId,
        patientId: r.patientId,
        doctorId: r.doctorId,
        paidPaise: Number(m?.paid ?? 0),
        feePaise: Number(m?.fee ?? 0),
        refundedPaise: Number(
          refunded.find((x) => x.source_id === r.appointmentId)?.paise ?? 0
        ),
      });
    }
    return out;
  }

  /** Our online refunds in the window that carry a Razorpay refund id. */
  private static async ourOnlineRefunds(from: Date) {
    const rows = (await database.execute(sql`
      SELECT gateway_ref AS ref, source_id AS "appointmentId" FROM money_entries
      WHERE account = 'clinic' AND entry_type = 'refund' AND channel = 'online'
        AND source_type = 'appointment' AND gateway_ref LIKE 'rfnd_%'
        AND created_at >= ${from.toISOString()}`)) as unknown as {
      ref: string;
      appointmentId: string;
    }[];
    return rows;
  }

  /** The two safe fixes, through the normal writers so a rerun writes nothing. */
  private static async fix(f: Finding, v: Visit) {
    await database.transaction(async (tx) => {
      if (f.kind === 'not_recorded')
        await AppointmentMoneySync.afterChange(
          tx,
          v.appointmentId,
          SYSTEM_ACTOR_ID,
          {
            move: {
              kind: 'pay',
              paymentMode: 'Online',
              channel: 'online',
              gatewayRef: f.ref,
              requestId: `razorpay:pay:${f.ref}`,
            },
          }
        );
      await OnlineFeeLedger.record(tx, {
        clinicId: v.clinicId,
        patientId: v.patientId,
        doctorId: v.doctorId,
        appointmentId: v.appointmentId,
        paymentId: f.ref,
        snapshot: v.snapshot,
      });
    });
  }

  /** Leaves tonight's list for the billing alert email (23:45); cleared when nothing needs a look. */
  private static async handOff(lines: string[]) {
    const key = CacheKeys.appointmentPaymentNeedsLook();
    try {
      if (lines.length)
        await redisClient.set(
          key,
          JSON.stringify(lines),
          'EX',
          HANDOFF_TTL_SEC
        );
      else await redisClient.del(key);
    } catch (err) {
      logger.error(
        '[AppointmentPaymentMatch] Could not hand off to the alert',
        err
      );
    }
  }
}
