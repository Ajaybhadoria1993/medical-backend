import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { BillingMismatchModel } from '../../models/billingMismatch.model';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { SubscriptionMandateModel } from '../../models/subscriptionMandate.model';
import {
  SubscriptionInvoiceModel,
  SubscriptionPaymentModel,
} from '../../models/subscriptionPayment.model';
import { SubscriptionWebhookEventModel } from '../../models/subscriptionWebhookEvent.model';
import { paiseToRupees, SALE_PAYMENT } from '../../utils/billingChecks.utils';
import { getClinicPort } from '../../ports';

const P = SubscriptionPaymentModel;

/** Read-only billing figures for the Super Admin dashboards, from the payments table (Q1). */
export class BillingReadService {
  /** Money received for subscriptions, add-ons and packs in [from, to); refunds shown apart. */
  static async collected(from: Date, to: Date) {
    const clinicSale = and(eq(P.ownerType, 'clinic'), SALE_PAYMENT);
    // Money counts in the period it arrived; a refund in the period it went back (marking it refunded stamps updatedAt).
    const [[row], [back]] = await Promise.all([
      database
        .select({
          received: sql<string>`coalesce(sum(${P.amountPaise}) filter (where ${P.status} in ('captured', 'refunded')), 0)`,
          payments: sql<number>`count(*) filter (where ${P.status} in ('captured', 'refunded'))::int`,
        })
        .from(P)
        .where(and(gte(P.paidAt, from), lt(P.paidAt, to), clinicSale)),
      database
        .select({ refunded: sql<string>`coalesce(sum(${P.amountPaise}), 0)` })
        .from(P)
        .where(
          and(
            eq(P.status, 'refunded'),
            gte(P.updatedAt, from),
            lt(P.updatedAt, to),
            clinicSale
          )
        ),
    ]);
    return {
      // Net of refunds, as the business keeps it.
      amount: paiseToRupees(row?.received) - paiseToRupees(back?.refunded),
      refunded: paiseToRupees(back?.refunded),
      payments: row?.payments ?? 0,
    };
  }

  /** Payments that did not go through in [from, to), newest first; AutoPay tries marked. */
  static async failed(from: Date, to: Date, limit = 50) {
    const rows = await database
      .select({
        clinicId: P.ownerId,
        amountPaise: P.amountPaise,
        at: P.updatedAt,
        kind: P.kind,
        reason: P.failureReason,
        autoPay: sql<boolean>`${P.mandateId} is not null`,
      })
      .from(P)
      .where(
        and(
          eq(P.ownerType, 'clinic'),
          eq(P.status, 'failed'),
          gte(P.updatedAt, from),
          lt(P.updatedAt, to),
          SALE_PAYMENT
        )
      )
      .orderBy(desc(P.updatedAt))
      .limit(limit);
    const clinics = await getClinicPort().getClinics(
      rows.map((r) => r.clinicId)
    );
    return rows.flatMap(({ amountPaise, ...r }) => {
      const c = clinics.get(r.clinicId);
      return c
        ? [
            {
              ...r,
              clinicCode: c.code,
              clinicName: c.name,
              amount: paiseToRupees(amountPaise),
            },
          ]
        : [];
    });
  }

  /** AutoPay at a glance: mandates by state, this period's charges, plans past due. */
  static async autoPay(from: Date, to: Date) {
    const M = SubscriptionMandateModel;
    const mandates = await database
      .select({ status: M.status, n: sql<number>`count(*)::int` })
      .from(M)
      .where(eq(M.ownerType, 'clinic'))
      .groupBy(M.status);
    const charges = await database
      .select({
        status: P.status,
        n: sql<number>`count(*)::int`,
        paise: sql<string>`coalesce(sum(${P.amountPaise}), 0)`,
      })
      .from(P)
      .where(
        and(
          eq(P.kind, 'renewal'),
          isNotNull(P.mandateId),
          gte(P.createdAt, from),
          lt(P.createdAt, to)
        )
      )
      .groupBy(P.status);
    const [pastDue] = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(SubscriptionModel)
      .where(
        and(
          eq(SubscriptionModel.ownerType, 'clinic'),
          eq(SubscriptionModel.status, 'past_due')
        )
      );
    const count = (rows: { status: string; n: number }[], s: string[]) =>
      rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.n, 0);
    return {
      active: count(mandates, ['active']),
      paused: count(mandates, ['paused']),
      cancelled: count(mandates, ['cancelled']),
      charges: {
        paid: count(charges, ['captured']),
        paidAmount: paiseToRupees(
          charges
            .filter((c) => c.status === 'captured')
            .reduce((t, c) => t + Number(c.paise), 0)
        ),
        pending: count(charges, ['created', 'pending']),
        failed: count(charges, ['failed']),
      },
      pastDue: pastDue?.n ?? 0,
    };
  }

  /** One clinic's billing for Super Admin: every payment with its Razorpay IDs and invoice, and its AutoPay. */
  static async clinic(clinicId: string) {
    const M = SubscriptionMandateModel;
    const B = BillingMismatchModel;
    // AutoPay on/off comes from Razorpay first: a token cancelled or paused there updates our row before it is shown.
    const [liveMandate] = await database
      .select()
      .from(M)
      .where(
        and(
          eq(M.ownerType, 'clinic'),
          eq(M.ownerId, clinicId),
          inArray(M.status, ['active', 'pending', 'paused']),
          isNotNull(M.providerTokenId)
        )
      )
      .orderBy(desc(M.createdAt))
      .limit(1);
    if (liveMandate) {
      // Imported here: AutoPay reads billing services, so a top-level import would be circular.
      const { AutoPayService } = await import('./autoPay.service');
      await AutoPayService.syncToken(liveMandate).catch((e) =>
        logger.warn(
          `[BillingRead] Live AutoPay check failed for clinic ${clinicId}:`,
          e
        )
      );
    }
    const [payments, mandates, open] = await Promise.all([
      database
        .select({
          id: P.id,
          kind: P.kind,
          status: P.status,
          amountPaise: P.amountPaise,
          discountPaise: P.discountPaise,
          lines: P.lines,
          method: P.paymentMethod,
          providerOrderId: P.providerOrderId,
          providerPaymentId: P.providerPaymentId,
          failureReason: P.failureReason,
          needsRefund: P.needsRefund,
          autoPay: sql<boolean>`${P.mandateId} is not null`,
          createdAt: P.createdAt,
          paidAt: P.paidAt,
          periodStart: P.periodStart,
          periodEnd: P.periodEnd,
          invoiceId: SubscriptionInvoiceModel.id,
          invoiceNumber: SubscriptionInvoiceModel.invoiceNumber,
        })
        .from(P)
        .leftJoin(
          SubscriptionInvoiceModel,
          eq(SubscriptionInvoiceModel.paymentId, P.id)
        )
        .where(and(eq(P.ownerType, 'clinic'), eq(P.ownerId, clinicId)))
        .orderBy(desc(P.createdAt))
        .limit(100),
      database
        .select()
        .from(M)
        .where(and(eq(M.ownerType, 'clinic'), eq(M.ownerId, clinicId)))
        .orderBy(desc(M.createdAt))
        .limit(5),
      database
        .select({ paymentId: B.paymentId, kind: B.kind })
        .from(B)
        .where(and(eq(B.ownerId, clinicId), eq(B.status, 'open'))),
    ]);
    const differs = new Map(open.map((o) => [o.paymentId, o.kind]));
    const live =
      mandates.find((m) => m.status === 'active' || m.status === 'paused') ??
      mandates[0] ??
      null;
    return {
      payments: payments.map(({ amountPaise, discountPaise, lines, ...p }) => ({
        ...p,
        amount: paiseToRupees(amountPaise),
        discount: paiseToRupees(discountPaise),
        // What was bought, in words, from the payment's own lines.
        items: lines.items
          .filter((l) => l.kind !== 'coupon')
          .map((l) => l.description),
        razorpayDiffers: differs.get(p.id) ?? null,
      })),
      autoPay: live
        ? {
            status: live.status,
            method: live.method,
            maxAmount: paiseToRupees(live.maxAmountPaise),
            providerCustomerId: live.providerCustomerId,
            providerTokenId: live.providerTokenId,
            authorizedAt: live.authorizedAt,
            cancelledAt: live.cancelledAt,
            reason: live.failureReason,
            updatedAt: live.updatedAt,
          }
        : null,
    };
  }

  /** Razorpay match at a glance, for the Revenue card and the Attention list. */
  static async matchSummary(from: Date, to: Date) {
    const B = BillingMismatchModel;
    const [open] = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(B)
      .where(eq(B.status, 'open'));
    const [ours] = await database
      .select({ paise: sql<string>`coalesce(sum(${P.amountPaise}), 0)` })
      .from(P)
      .where(
        and(
          inArray(P.status, ['captured', 'refunded']),
          gte(P.paidAt, from),
          lt(P.paidAt, to),
          SALE_PAYMENT
        )
      );
    const W = SubscriptionWebhookEventModel;
    const [hook] = await database
      .select({ last: sql<Date | null>`max(${W.receivedAt})` })
      .from(W);
    return {
      openDifferences: open?.n ?? 0,
      ourTotal: paiseToRupees(ours?.paise),
      lastWebhookAt: hook?.last ?? null,
    };
  }
}
