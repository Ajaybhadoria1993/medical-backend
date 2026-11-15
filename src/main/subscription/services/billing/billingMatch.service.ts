import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { razorpayClient } from '../../gateway/razorpay.client';
import { BillingMismatchModel } from '../../models/billingMismatch.model';
import type { FoundMismatch, RzpPayment } from '../../types/billingMatch.types';
import {
  SubscriptionPaymentModel,
  type SubscriptionPayment,
} from '../../models/subscriptionPayment.model';
import { SubscriptionWebhookEventModel } from '../../models/subscriptionWebhookEvent.model';
import { MAX_WEBHOOK_ATTEMPTS } from '../../utils/webhookEvent.utils';
import {
  DAY_MS as DAY,
  MATCH_WINDOW_DAYS as WINDOW_DAYS,
  RAZORPAY_PAGE as PAGE,
  REFUND_STUCK_AFTER_MS as REFUND_STUCK_AFTER,
} from '../../utils/billingChecks.utils';
import { PaymentsService } from './payments.service';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { GRACE_DAYS } from '../../utils/subscriptionState.utils';
import { getClinicPort } from '../../ports';

/** Daily: compares our subscription payments with Razorpay and keeps the differences for a Super Admin. */
export class BillingMatchService {
  static async run(now = new Date()) {
    const from = new Date(now.getTime() - WINDOW_DAYS * DAY);
    const ours = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          gte(SubscriptionPaymentModel.createdAt, from),
          isNotNull(SubscriptionPaymentModel.providerOrderId)
        )
      );
    const byOrder = new Map(ours.map((r) => [r.providerOrderId!, r]));
    const theirs = await BillingMatchService.razorpayPayments(from, now);

    const found: FoundMismatch[] = [];
    for (const p of theirs) {
      // Appointment and Route payments are not subscription orders; only our rows are compared.
      const row = p.order_id ? byOrder.get(p.order_id) : undefined;
      if (!row) continue;
      const mismatch = BillingMatchService.compare(row, p);
      if (mismatch) found.push(mismatch);
    }
    for (const row of ours) {
      if (
        row.needsRefund &&
        now.getTime() - row.updatedAt.getTime() > REFUND_STUCK_AFTER
      ) {
        found.push({
          kind: 'refund_stuck',
          row,
          providerPaymentId: row.providerPaymentId,
          ours: { status: row.status, needsRefund: true, since: row.updatedAt },
          theirs: {},
        });
      }
    }

    found.push(...(await BillingMatchService.refundsOwed(ours, now)));

    for (const f of found) await BillingMatchService.record(f, now);
    // Anything open in this window that did not show up again now matches.
    const stillOpen = new Set(found.map((f) => `${f.kind}:${f.row.id}`));
    const open = await database
      .select()
      .from(BillingMismatchModel)
      .where(
        and(
          eq(BillingMismatchModel.status, 'open'),
          lt(BillingMismatchModel.lastSeenAt, now)
        )
      );
    let cleared = 0;
    for (const m of open) {
      if (
        m.paymentId &&
        byOrder.has(m.providerOrderId ?? '') &&
        !stillOpen.has(`${m.kind}:${m.paymentId}`)
      ) {
        await database
          .update(BillingMismatchModel)
          .set({
            status: 'resolved',
            resolvedAt: now,
            resolution: 'Matched on a later check',
          })
          .where(eq(BillingMismatchModel.id, m.id));
        cleared++;
      }
    }
    logger.info(
      `[BillingMatch] Compared ${ours.length} payments with ${theirs.length} at Razorpay: ${found.length} differences, ${cleared} now match`
    );
    return {
      compared: ours.length,
      razorpay: theirs.length,
      differences: found.length,
      cleared,
    };
  }

  /** "Check now" from the Billing checks tab: run, then return the fresh list. */
  static async runNow() {
    const result = await BillingMatchService.run();
    return { ...result, ...(await BillingMatchService.overview()) };
  }

  /** One payment: what Razorpay says against our row. */
  static compare(
    row: SubscriptionPayment,
    p: RzpPayment
  ): FoundMismatch | null {
    const base = {
      row,
      providerPaymentId: p.id,
      ours: { status: row.status, amountPaise: row.amountPaise },
      theirs: {
        status: p.status,
        amountPaise: p.amount,
        refundStatus: p.refund_status ?? null,
      },
    };
    const applied = row.status === 'captured' || row.status === 'refunded';
    if (p.status === 'captured' && !applied)
      return { ...base, kind: 'not_applied' };
    if (p.status === 'captured' && Number(p.amount) !== row.amountPaise)
      return { ...base, kind: 'amount_differs' };
    // The AutoPay ₹1 check and a refunded duplicate are meant to be refunded at Razorpay.
    const refundExpected =
      row.kind === 'mandate_setup' ||
      row.needsRefund ||
      row.status === 'refunded';
    if (row.status === 'captured' && p.status === 'refunded' && !refundExpected)
      return { ...base, kind: 'state_differs' };
    // An order can hold a failed try before the paid one; only the payment we recorded counts.
    if (
      row.status === 'captured' &&
      p.status === 'failed' &&
      p.id === row.providerPaymentId
    )
      return { ...base, kind: 'state_differs' };
    return null;
  }

  /** Add-ons paid ahead for a period that was never paid; skipped once a Super Admin resolved one. */
  private static async refundsOwed(ours: SubscriptionPayment[], now: Date) {
    const candidates = ours
      .filter(
        (r) =>
          r.kind === 'addon_purchase' &&
          r.status === 'captured' &&
          r.subscriptionId
      )
      .map((row) => ({
        row,
        ahead: row.lines.items.filter(
          (l) => l.kind === 'addon' && (l.nextPeriodPaise ?? 0) > 0
        ),
      }))
      .filter((c) => c.ahead.length);
    if (!candidates.length) return [];
    // Two batch reads instead of two queries per payment.
    const [subs, settled] = await Promise.all([
      database
        .select({
          id: SubscriptionModel.id,
          currentPeriodEnd: SubscriptionModel.currentPeriodEnd,
        })
        .from(SubscriptionModel)
        .where(
          inArray(SubscriptionModel.id, [
            ...new Set(candidates.map((c) => c.row.subscriptionId!)),
          ])
        ),
      database
        .select({ paymentId: BillingMismatchModel.paymentId })
        .from(BillingMismatchModel)
        .where(
          and(
            eq(BillingMismatchModel.kind, 'refund_owed'),
            eq(BillingMismatchModel.status, 'resolved'),
            inArray(
              BillingMismatchModel.paymentId,
              candidates.map((c) => c.row.id)
            )
          )
        ),
    ]);
    const endOf = new Map(subs.map((s) => [s.id, s.currentPeriodEnd]));
    const done = new Set(settled.map((s) => s.paymentId));
    const found: FoundMismatch[] = [];
    for (const { row, ahead } of candidates) {
      const end = endOf.get(row.subscriptionId!);
      const coverEnd = new Date(ahead[0]!.periodEnd!);
      // Owed only once the plan was never extended into that period and the grace days are over.
      if (
        !end ||
        end >= coverEnd ||
        now.getTime() < end.getTime() + GRACE_DAYS * DAY
      )
        continue;
      if (done.has(row.id)) continue;
      found.push({
        kind: 'refund_owed',
        row,
        providerPaymentId: row.providerPaymentId,
        ours: {
          status: 'refund owed',
          amountPaise: ahead.reduce((s, l) => s + l.nextPeriodPaise!, 0),
          periodEnd: coverEnd,
        },
        theirs: { status: row.status, amountPaise: row.amountPaise },
      });
    }
    return found;
  }

  private static async record(f: FoundMismatch, now: Date) {
    await database
      .insert(BillingMismatchModel)
      .values({
        kind: f.kind,
        ownerType: f.row.ownerType,
        ownerId: f.row.ownerId,
        paymentId: f.row.id,
        providerOrderId: f.row.providerOrderId,
        providerPaymentId: f.providerPaymentId,
        ours: f.ours,
        theirs: f.theirs,
        detectedAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [BillingMismatchModel.kind, BillingMismatchModel.paymentId],
        targetWhere: sql`${BillingMismatchModel.status} = 'open'`,
        set: { ours: f.ours, theirs: f.theirs, lastSeenAt: now },
      });
  }

  private static async razorpayPayments(from: Date, to: Date) {
    const all: RzpPayment[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const page = await razorpayClient.listPayments({
        from: Math.floor(from.getTime() / 1000),
        to: Math.floor(to.getTime() / 1000),
        count: PAGE,
        skip,
      });
      all.push(...(page.items as unknown as RzpPayment[]));
      if (page.items.length < PAGE) break;
    }
    return all;
  }

  /** The Billing checks tab: open differences with clinic names, and webhook health. */
  static async overview() {
    const W = SubscriptionWebhookEventModel;
    const [rows, [hooks], [lastRun], stuckEvents] = await Promise.all([
      database
        .select({ m: BillingMismatchModel })
        .from(BillingMismatchModel)
        .where(eq(BillingMismatchModel.status, 'open'))
        .orderBy(desc(BillingMismatchModel.detectedAt))
        .limit(200),
      database
        .select({
          lastReceivedAt: sql<Date | null>`max(${W.receivedAt})`,
          retrying: sql<number>`count(*) filter (where ${W.status} = 'failed' and ${W.attempts} < ${MAX_WEBHOOK_ATTEMPTS})::int`,
          gaveUp: sql<number>`count(*) filter (where ${W.status} = 'failed' and ${W.attempts} >= ${MAX_WEBHOOK_ATTEMPTS})::int`,
        })
        .from(W),
      database
        .select({
          at: sql<Date | null>`max(${BillingMismatchModel.lastSeenAt})`,
        })
        .from(BillingMismatchModel),
      // Events that ran out of tries: a Super Admin can retry each one.
      database
        .select({
          id: W.id,
          eventType: W.eventType,
          error: W.error,
          attempts: W.attempts,
          receivedAt: W.receivedAt,
        })
        .from(W)
        .where(
          and(eq(W.status, 'failed'), gte(W.attempts, MAX_WEBHOOK_ATTEMPTS))
        )
        .orderBy(desc(W.receivedAt))
        .limit(50),
    ]);
    const clinics = await getClinicPort().getClinics(
      rows.map((r) => r.m.ownerId)
    );
    return {
      mismatches: rows.map(({ m }) => ({
        ...m,
        clinicName: clinics.get(m.ownerId)?.name ?? null,
      })),
      webhook: hooks ?? { lastReceivedAt: null, retrying: 0, gaveUp: 0 },
      lastSeenAt: lastRun?.at ?? null,
      stuckEvents,
    };
  }

  /** Retry: apply a payment Razorpay captured, or refund one we owe; then check that payment again. */
  static async retry(id: string) {
    const m = await BillingMatchService.open(id);
    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(eq(SubscriptionPaymentModel.id, m.paymentId!))
      .limit(1);
    if (!row)
      throw new HttpError(
        404,
        'The payment for this difference was not found.'
      );
    if (m.kind === 'not_applied') {
      await PaymentsService.activatePayment({
        paymentRowId: row.id,
        providerPaymentId: m.providerPaymentId,
      });
    } else if (m.kind === 'refund_stuck') {
      await PaymentsService.refundDuplicate(row);
    } else {
      throw new HttpError(
        409,
        'This difference needs a person to look at it. Mark it resolved with what you did.'
      );
    }
    if (row.providerPaymentId || m.providerPaymentId) {
      const p = (await razorpayClient.fetchPayment(
        (m.providerPaymentId ?? row.providerPaymentId)!
      )) as unknown as RzpPayment;
      const [fresh] = await database
        .select()
        .from(SubscriptionPaymentModel)
        .where(eq(SubscriptionPaymentModel.id, row.id))
        .limit(1);
      if (
        fresh &&
        !BillingMatchService.compare(fresh, p) &&
        !(fresh.needsRefund && m.kind === 'refund_stuck')
      ) {
        await BillingMatchService.close(m.id, null, 'Fixed by Retry');
      }
    }
    return BillingMatchService.overview();
  }

  /** A person checked it and says what they did. */
  static async resolve(id: string, userId: string, reason: string) {
    await BillingMatchService.open(id);
    await BillingMatchService.close(id, userId, reason);
    return BillingMatchService.overview();
  }

  private static async open(id: string) {
    const [m] = await database
      .select()
      .from(BillingMismatchModel)
      .where(eq(BillingMismatchModel.id, id))
      .limit(1);
    if (!m) throw new HttpError(404, 'This difference was not found.');
    if (m.status !== 'open')
      throw new HttpError(409, 'This difference is already resolved.');
    return m;
  }

  private static async close(
    id: string,
    userId: string | null,
    reason: string
  ) {
    await database
      .update(BillingMismatchModel)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolution: reason.slice(0, 500),
      })
      .where(
        and(
          eq(BillingMismatchModel.id, id),
          inArray(BillingMismatchModel.status, ['open'])
        )
      );
  }
}
