import { and, asc, desc, eq, gt, inArray, isNotNull, ne } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { envConfig } from '../../../../utils/envConfig';
import logger from '../../../../utils/logger';
import { getOrSetCache } from '../../../../utils/cache.util';
import { fromPaise, toPaise } from '../../../money';
import { razorpayClient } from '../../gateway/razorpay.client';
import {
  SubscriptionMandateModel,
  type SubscriptionMandate,
} from '../../models/subscriptionMandate.model';
import {
  SubscriptionPaymentModel,
  type SubscriptionPayment,
} from '../../models/subscriptionPayment.model';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { AutoPayLimitService } from './autoPayLimit.service';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { AutoPayMethod } from '../../types/autoPay.types';
import {
  AUTOPAY_CHECK_PAISE,
  autoPayTokenExpiry,
  limitForMethod,
  limitResponse,
} from '../../utils/autoPay.utils';
import { getClinicPort } from '../../ports';

export type { AutoPayMethod } from '../../types/autoPay.types';

/** AutoPay (decision B, D8): monthly paid plans only; we keep the Razorpay token and charge it ourselves. */
/** A live AutoPay's Razorpay check is reused for this long; webhooks and the daily job cover the gap. */
const TOKEN_CACHE_S = 60;
/** A past payment's method never changes. */
const PAID_WITH_CACHE_S = 24 * 60 * 60;

/** Our mandate status for a Razorpay token state; unknown states keep ours. */
export const stateOfToken = (t: RzpToken) => {
  const s = t.recurring_details?.status;
  return s === 'confirmed'
    ? 'active'
    : s === 'rejected'
      ? 'failed'
      : s === 'cancelled' || s === 'cancellation_initiated'
        ? 'cancelled'
        : s === 'paused'
          ? 'paused'
          : null;
};

/** Razorpay sends net-banking banks as codes ("ICIC"); the common ones get their name. */
const BANK_NAMES: Record<string, string> = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB_R: 'Punjab National Bank',
  BARB_R: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  IDIB: 'Indian Bank',
  BKID: 'Bank of India',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  IDFB: 'IDFC FIRST Bank',
  FDRL: 'Federal Bank',
};

/** The fields we read from a Razorpay token. */
export type RzpToken = {
  method?: string;
  bank?: string | null;
  expired_at?: number | null;
  card?: {
    network?: string;
    last4?: string;
    issuer?: string | null;
    expiry_month?: string;
    expiry_year?: string;
  } | null;
  vpa?: { username?: string; handle?: string } | null;
  bank_details?: {
    account_number?: string;
    ifsc?: string;
    beneficiary_name?: string;
  } | null;
  recurring_details?: { status?: string; failure_reason?: string | null };
};

/** What the clinic pays with, from Razorpay's token: "Visa •••• 4366", a UPI ID or a bank account. */
const instrumentOf = (t: RzpToken) => {
  const last4 = (v?: string | null) =>
    v ? v.replace(/\D/g, '').slice(-4) : '';
  if (t.card?.last4) {
    return {
      method: 'card' as const,
      label: `${t.card.network ?? 'Card'} •••• ${t.card.last4}`,
      detail:
        [
          t.card.issuer,
          t.card.expiry_month && t.card.expiry_year
            ? `expires ${t.card.expiry_month}/${String(t.card.expiry_year).slice(-2)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      validUntil: t.expired_at
        ? new Date(t.expired_at * 1000).toISOString()
        : null,
    };
  }
  if (t.vpa?.username) {
    return {
      method: 'upi' as const,
      label: t.vpa.handle
        ? `${t.vpa.username}@${t.vpa.handle}`
        : t.vpa.username,
      detail: 'UPI AutoPay',
      validUntil: t.expired_at
        ? new Date(t.expired_at * 1000).toISOString()
        : null,
    };
  }
  const acct = last4(t.bank_details?.account_number);
  return {
    method: 'emandate' as const,
    label: `${(t.bank && BANK_NAMES[t.bank]) || t.bank || 'Bank account'}${acct ? ` •••• ${acct}` : ''}`,
    detail: t.bank_details?.ifsc ?? 'Bank mandate',
    validUntil: t.expired_at
      ? new Date(t.expired_at * 1000).toISOString()
      : null,
  };
};

export class AutoPayService {
  /** Why a clinic can or cannot turn AutoPay on, and what one renewal costs today. */
  static async eligibility(clinicId: string) {
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const sub = current?.subscription;
    const refuse = (reason: string) => ({
      eligible: false as const,
      reason,
      renewalPaise: 0,
    });
    if (!envConfig.ENABLE_SUBSCRIPTION_PAYMENTS) {
      return refuse('AutoPay is not available right now.');
    }
    if (!current?.state.isValid || current.plan.kind !== 'paid' || !sub) {
      return refuse('AutoPay is for paid plans.');
    }
    // A trial renews monthly at its end, so AutoPay can be set up during it.
    if (sub.billingCycle !== 'monthly' && !sub.isTrial)
      return refuse('AutoPay is for monthly plans only.');
    if (sub.cancelAtPeriodEnd)
      return refuse('Your plan is set to end, so it will not renew.');
    // Imported here: the overview reads billing services that import this one.
    const { SubscriptionOverviewService } =
      await import('../core/subscriptionOverview.service');
    const overview = await SubscriptionOverviewService.get(clinicId);
    const renewalPaise = toPaise(overview.upcomingRenewal?.totalAmount ?? 0);
    if (renewalPaise <= 0) return refuse('There is nothing to renew.');
    return { eligible: true as const, reason: null, renewalPaise };
  }

  static async active(clinicId: string): Promise<SubscriptionMandate | null> {
    const [row] = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          eq(SubscriptionMandateModel.ownerId, clinicId),
          eq(SubscriptionMandateModel.status, 'active')
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** The billing page's AutoPay card: on/off, method and limit, or why it can't be turned on. */
  static async status(clinicId: string) {
    const [eligibility, mandate] = await Promise.all([
      AutoPayService.eligibility(clinicId),
      AutoPayService.latestOpen(clinicId),
    ]);
    let token: RzpToken | null = null;
    if (
      mandate?.providerTokenId &&
      (mandate.status === 'pending' ||
        mandate.status === 'active' ||
        mandate.status === 'paused')
    ) {
      const live = () => AutoPayService.syncToken(mandate);
      token = await (
        mandate.status === 'active'
          ? getOrSetCache(`autopay:token:${mandate.id}`, TOKEN_CACHE_S, live)
          : live()
      ).catch((e) => {
        // Razorpay unreachable: show what we last knew; webhooks and the daily check still catch up.
        logger.warn(
          `[AutoPay] Live token check failed for mandate ${mandate.id}:`,
          e
        );
        return null;
      });
    }
    const seen = token ? stateOfToken(token) : null;
    const changed = !!mandate && seen !== null && seen !== mandate.status;
    const fresh = changed ? await AutoPayService.byId(mandate!.id) : mandate;
    const isOn = fresh?.status === 'active';
    return {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      isOn,
      // Renewal grew past the approved limit (more add-ons, a price rise): approve again to keep AutoPay charging.
      needsNewLimit:
        isOn &&
        eligibility.eligible &&
        eligibility.renewalPaise > fresh!.maxAmountPaise,
      renewalAmount: eligibility.renewalPaise / 100,
      // The limit a new approval would ask for, with its parts; shown before the clinic approves.
      ...(await AutoPayService.proposal(clinicId, eligibility)),
      mandate: fresh
        ? {
            status: fresh.status,
            method: fresh.method,
            maxAmount: fresh.maxAmountPaise / 100,
            authorizedAt: fresh.authorizedAt,
            failureReason: fresh.failureReason,
            // As Razorpay holds it: card, UPI ID or bank account; null when Razorpay could not be asked.
            instrument:
              token && fresh.status === 'active' ? instrumentOf(token) : null,
          }
        : null,
      // With AutoPay off: how the clinic last paid, from Razorpay, to offer it for AutoPay.
      lastPayment: isOn ? null : await AutoPayService.lastPayment(clinicId),
    };
  }

  /** The clinic's latest paid subscription payment and its method as Razorpay recorded it; null if none or unreachable. */
  private static async lastPayment(clinicId: string) {
    const [row] = await database
      .select({
        providerPaymentId: SubscriptionPaymentModel.providerPaymentId,
        amountPaise: SubscriptionPaymentModel.amountPaise,
        paidAt: SubscriptionPaymentModel.paidAt,
      })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.status, 'captured'),
          ne(SubscriptionPaymentModel.kind, 'mandate_setup')
        )
      )
      .orderBy(desc(SubscriptionPaymentModel.paidAt))
      .limit(1);
    if (!row?.providerPaymentId) return null;
    const paymentId = row.providerPaymentId;
    try {
      const method = await getOrSetCache(
        `autopay:paid-with:${paymentId}`,
        PAID_WITH_CACHE_S,
        () => AutoPayService.paidWith(paymentId)
      );
      return {
        ...method,
        amount: fromPaise(row.amountPaise),
        paidAt: row.paidAt,
      };
    } catch (e) {
      logger.warn(
        `[AutoPay] Could not read the last payment ${paymentId} from Razorpay:`,
        e
      );
      return null;
    }
  }

  /** How a payment was made, as Razorpay recorded it; the card is fetched only for card payments. */
  private static async paidWith(paymentId: string) {
    const p = (await razorpayClient.fetchPayment(paymentId)) as {
      method?: string;
      vpa?: string | null;
      bank?: string | null;
      wallet?: string | null;
    };
    let label: string;
    if (p.method === 'upi') label = p.vpa ? `UPI · ${p.vpa}` : 'UPI';
    else if (p.method === 'card') {
      const card = (await razorpayClient.fetchPaymentCard(paymentId)) as {
        network?: string;
        last4?: string;
      };
      label = card?.last4
        ? `${card.network ?? 'Card'} •••• ${card.last4}`
        : 'Card';
    } else if (p.method === 'netbanking')
      label = p.bank
        ? `Net banking · ${BANK_NAMES[p.bank] ?? p.bank}`
        : 'Net banking';
    else if (p.method === 'wallet')
      label = p.wallet ? `Wallet · ${p.wallet}` : 'Wallet';
    else label = p.method ?? 'Online payment';
    return {
      method: p.method ?? null,
      label,
      // UPI, cards and bank accounts can run AutoPay; wallets cannot.
      autoPayReady:
        p.method === 'upi' || p.method === 'card' || p.method === 'netbanking',
    };
  }

  /** A pending mandate to approve in checkout, with its Razorpay customer; used alone or with a plan purchase. */
  static async prepare(input: {
    clinicId: string;
    method: AutoPayMethod;
    maxAmountPaise: number;
    email?: string;
  }) {
    // An approval while AutoPay is on changes the method or raises the limit; activate() retires the old one.
    const customerId = await AutoPayService.customerFor(
      input.clinicId,
      input.email
    );
    // An older approval that never finished is replaced by this one.
    await database
      .update(SubscriptionMandateModel)
      .set({
        status: 'failed',
        failureReason: 'Replaced by a new AutoPay setup',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          eq(SubscriptionMandateModel.ownerId, input.clinicId),
          eq(SubscriptionMandateModel.status, 'pending')
        )
      );
    const [mandate] = await database
      .insert(SubscriptionMandateModel)
      .values({
        ownerType: 'clinic',
        ownerId: input.clinicId,
        providerCustomerId: customerId,
        method: input.method,
        maxAmountPaise: limitForMethod(input.maxAmountPaise, input.method),
        tokenExpiresAt: autoPayTokenExpiry(),
        status: 'pending',
      })
      .returning();
    return { mandate: mandate!, customerId };
  }

  /** Plan + every add-on at its cap on the clinic's current plan version. */
  private static async proposal(
    clinicId: string,
    eligibility: Awaited<ReturnType<typeof AutoPayService.eligibility>>
  ) {
    const limit = eligibility.eligible
      ? AutoPayLimitService.forRenewal(eligibility.renewalPaise)
      : null;
    if (!limit)
      return {
        proposedLimit: null,
        autoPayLimitLines: [],
        autoPayUncapped: [],
        autoPayMethodCaps: null,
      };
    const { autoPayLimit, ...rest } = limitResponse(limit);
    return { proposedLimit: autoPayLimit, ...rest };
  }

  /** "Turn on AutoPay" on a plan already paid for: a small check payment registers the token. */
  static async startSetup(input: {
    clinicId: string;
    method: AutoPayMethod;
    idempotencyKey: string;
    email?: string;
  }) {
    const [replay] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, input.clinicId),
          eq(SubscriptionPaymentModel.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (replay?.providerOrderId && replay.mandateId) {
      return AutoPayService.checkoutResponse(replay);
    }

    const eligibility = await AutoPayService.eligibility(input.clinicId);
    if (!eligibility.eligible) throw new HttpError(409, eligibility.reason);
    const { mandate, customerId } = await AutoPayService.prepare({
      clinicId: input.clinicId,
      method: input.method,
      maxAmountPaise: AutoPayLimitService.forRenewal(eligibility.renewalPaise)
        .limitPaise,
      email: input.email,
    });
    const amountPaise = AUTOPAY_CHECK_PAISE[input.method];
    const [row] = await database
      .insert(SubscriptionPaymentModel)
      .values({
        ownerType: 'clinic',
        ownerId: input.clinicId,
        kind: 'mandate_setup',
        status: 'created',
        amountPaise,
        discountPaise: 0,
        lines: {
          version: 1,
          items: [
            {
              kind: 'adjustment',
              description: 'AutoPay approval check',
              amountPaise,
            },
          ],
        },
        provider: 'razorpay',
        mandateId: mandate.id,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    try {
      const order = await razorpayClient.createMandateOrder({
        amountPaise,
        customerId,
        method: input.method,
        maxAmountPaise: mandate.maxAmountPaise,
        expireAt: mandate.tokenExpiresAt ?? autoPayTokenExpiry(),
        receipt: row!.id,
        notes: {
          paymentId: row!.id,
          clinicId: input.clinicId,
          kind: 'mandate_setup',
        },
      });
      const [withOrder] = await database
        .update(SubscriptionPaymentModel)
        .set({ providerOrderId: order.id, updatedAt: new Date() })
        .where(eq(SubscriptionPaymentModel.id, row!.id))
        .returning();
      return AutoPayService.checkoutResponse(withOrder!);
    } catch (e) {
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'failed',
          failureReason: String((e as Error).message ?? e).slice(0, 255),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionPaymentModel.id, row!.id));
      await AutoPayService.markFailed(
        mandate.id,
        'Could not start AutoPay at Razorpay'
      );
      throw e;
    }
  }

  /** Extra fields Razorpay Checkout needs to show the AutoPay approval. */
  static async checkoutFields(mandateId: string) {
    const mandate = await AutoPayService.byId(mandateId);
    return mandate
      ? {
          customerId: mandate.providerCustomerId,
          recurring: true,
          autoPayMethod: mandate.method,
        }
      : {};
  }

  private static async checkoutResponse(row: SubscriptionPayment) {
    return {
      requiresPayment: true,
      paymentId: row.id,
      orderId: row.providerOrderId,
      amount: row.amountPaise,
      currency: row.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      ...(row.mandateId
        ? await AutoPayService.checkoutFields(row.mandateId)
        : {}),
    };
  }

  /** After a payment that carried an AutoPay approval: keep its token and turn AutoPay on once confirmed. */
  static async afterPayment(payment: SubscriptionPayment) {
    if (!payment.mandateId || !payment.providerPaymentId) return;
    try {
      const mandate = await AutoPayService.byId(payment.mandateId);
      if (!mandate || mandate.status === 'cancelled') return;
      const paid = (await razorpayClient.fetchPayment(
        payment.providerPaymentId
      )) as {
        token_id?: string;
        method?: string;
        status?: string;
      };
      if (paid.token_id && !mandate.providerTokenId) {
        await database
          .update(SubscriptionMandateModel)
          .set({ providerTokenId: paid.token_id, updatedAt: new Date() })
          .where(eq(SubscriptionMandateModel.id, mandate.id));
      }
      const fresh = await AutoPayService.byId(mandate.id);
      if (fresh?.providerTokenId) await AutoPayService.syncToken(fresh);
      // The ₹1 approval check is not a sale; it goes back to the clinic.
      // Razorpay may already have refunded it; a second refund would only fail.
      if (
        payment.kind === 'mandate_setup' &&
        payment.amountPaise > 0 &&
        paid.status === 'captured'
      ) {
        await razorpayClient
          .refundPayment(payment.providerPaymentId, {
            reason: 'AutoPay approval check',
          })
          .catch((e) =>
            logger.error(`[AutoPay] Refund of check ${payment.id} failed:`, e)
          );
      }
    } catch (e) {
      // The token webhook or the next status check finishes it; the payment itself stands.
      logger.error(
        `[AutoPay] Linking payment ${payment.id} to its mandate failed:`,
        e
      );
    }
  }

  /** The clinic turns AutoPay off; returns the new status for the billing page. */
  static async disable(clinicId: string) {
    await AutoPayService.stop(clinicId, 'Turned off by the clinic');
    // AutoPay is already off here; a failure building the full status must not report the cancel as failed.
    return AutoPayService.status(clinicId).catch((e) => {
      logger.error(
        `[AutoPay] Clinic ${clinicId}: AutoPay is off, but its status could not be built:`,
        e
      );
      return { eligible: false, reason: null, isOn: false, mandate: null };
    });
  }

  /** Checkout's success callback for an approval: the order must be this clinic's approval order. */
  static async verifySetup(
    clinicId: string,
    input: { orderId: string; paymentId: string; signature: string }
  ) {
    // Imported here: payments imports this service.
    const { PaymentsService } = await import('./payments.service');
    const payment = await PaymentsService.findByOrder(clinicId, input.orderId);
    if (!payment || payment.kind !== 'mandate_setup') {
      throw new HttpError(404, 'This AutoPay approval was not found.');
    }
    await PaymentsService.verifyCheckout({
      payment,
      providerPaymentId: input.paymentId,
      signature: input.signature,
    });
    return AutoPayService.status(clinicId);
  }

  /** Turns AutoPay off: every live approval is cancelled here and at Razorpay. */
  static async stop(clinicId: string, reason: string) {
    const now = new Date();
    const stopped = await database
      .update(SubscriptionMandateModel)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        failureReason: reason.slice(0, 255),
        updatedAt: now,
      })
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          eq(SubscriptionMandateModel.ownerId, clinicId),
          inArray(SubscriptionMandateModel.status, [
            'active',
            'pending',
            'paused',
          ])
        )
      )
      .returning();
    if (stopped[0]) await AutoPayService.tell(stopped[0], false, reason);
    for (const m of stopped) {
      if (!m.providerTokenId) continue;
      // Our row already says off, so no charge starts; a Razorpay error is only logged.
      await razorpayClient
        .stopToken(m.providerCustomerId, m.providerTokenId, m.method)
        // cancellation_initiated is normal for UPI: Razorpay finishes it and sends token.cancelled.
        .then((r) =>
          logger.info(
            `[AutoPay] Mandate ${m.id} cancel sent to Razorpay: ${(r as { recurring_details?: { status?: string } })?.recurring_details?.status ?? 'sent'}`
          )
        )
        .catch((e) =>
          logger.error(
            `[AutoPay] Cancelling token of mandate ${m.id} failed:`,
            e
          )
        );
    }
    return stopped.length;
  }

  /** Razorpay `token.*` webhooks; a token we do not know yet is settled by afterPayment. */
  static async onTokenEvent(
    event: string,
    tokenId: string | undefined,
    reason?: string
  ) {
    if (!tokenId) return;
    const [mandate] = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(eq(SubscriptionMandateModel.providerTokenId, tokenId))
      .limit(1);
    if (!mandate) return;
    if (event === 'token.confirmed') await AutoPayService.activate(mandate);
    else if (event === 'token.rejected')
      await AutoPayService.markFailed(
        mandate.id,
        reason ?? 'Approval was declined'
      );
    else if (event === 'token.cancelled')
      await AutoPayService.setStatus(mandate.id, 'cancelled');
    else if (event === 'token.paused')
      await AutoPayService.setStatus(mandate.id, 'paused');
  }

  /** Mandates in the given states, a page at a time in id order, for the daily jobs. */
  static async mandatePage(
    statuses: SubscriptionMandate['status'][],
    afterId: string | null,
    limit = AutoPayService.PAGE
  ) {
    return database
      .select()
      .from(SubscriptionMandateModel)
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          inArray(SubscriptionMandateModel.status, statuses),
          afterId ? gt(SubscriptionMandateModel.id, afterId) : undefined
        )
      )
      .orderBy(asc(SubscriptionMandateModel.id))
      .limit(limit);
  }

  private static readonly PAGE = 200;

  /** Daily: an AutoPay turned off here (last 60 days) but still live at Razorpay gets its cancel sent again,
   *  so a cancel that failed once heals instead of leaving a live bank mandate. */
  static async finishCancels(now = new Date()) {
    const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const rows = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          inArray(SubscriptionMandateModel.status, ['cancelled']),
          isNotNull(SubscriptionMandateModel.providerTokenId),
          gt(SubscriptionMandateModel.updatedAt, since)
        )
      );
    let resent = 0;
    for (const m of rows) {
      try {
        const token = (await razorpayClient.fetchToken(
          m.providerCustomerId,
          m.providerTokenId!
        )) as RzpToken;
        const state = token.recurring_details?.status;
        if (state !== 'confirmed' && state !== 'paused') continue;
        await razorpayClient.stopToken(
          m.providerCustomerId,
          m.providerTokenId!,
          m.method
        );
        resent++;
        logger.warn(
          `[AutoPay] Mandate ${m.id} was off here but ${state} at Razorpay; cancel sent again`
        );
      } catch (e) {
        // Already deleted at Razorpay (a stopped card token): nothing left to cancel.
        if (String((e as Error)?.message).includes('does not exist')) continue;
        logger.error(
          `[AutoPay] Finishing the cancel of mandate ${m.id} failed:`,
          e
        );
      }
    }
    return { checked: rows.length, resent };
  }

  /** Daily: asks Razorpay about every live AutoPay, so a cancel from the bank app is caught even without its webhook. */
  static async syncAll() {
    let changed = 0;
    let checked = 0;
    for (let after: string | null = null; ;) {
      const live = await AutoPayService.mandatePage(
        ['active', 'paused'],
        after
      );
      if (!live.length) break;
      after = live[live.length - 1]!.id;
      checked += live.length;
      for (const m of live) {
        if (!m.providerTokenId) continue;
        try {
          const token = (await razorpayClient.fetchToken(
            m.providerCustomerId,
            m.providerTokenId
          )) as {
            recurring_details?: {
              status?: string;
              failure_reason?: string | null;
            };
          };
          const state = token.recurring_details?.status;
          const next =
            state === 'confirmed'
              ? 'active'
              : state === 'paused'
                ? 'paused'
                : state === 'cancelled' || state === 'cancellation_initiated'
                  ? 'cancelled'
                  : state === 'rejected'
                    ? 'failed'
                    : null;
          if (!next || next === m.status) continue;
          const now = new Date();
          await database
            .update(SubscriptionMandateModel)
            .set({
              status: next,
              ...(next === 'cancelled' ? { cancelledAt: now } : {}),
              ...(next === 'failed'
                ? {
                    failureReason:
                      token.recurring_details?.failure_reason ??
                      'Declined at the bank',
                  }
                : {}),
              updatedAt: now,
            })
            .where(eq(SubscriptionMandateModel.id, m.id));
          logger.warn(
            `[AutoPay] Mandate ${m.id} for clinic ${m.ownerId}: ${m.status} -> ${next} (found at Razorpay)`
          );
          if (
            m.status === 'active' &&
            (next === 'cancelled' || next === 'paused')
          ) {
            await AutoPayService.tell(m, false, AutoPayService.BANK_OFF);
          }
          changed++;
        } catch (e) {
          logger.error(
            `[AutoPay] Checking mandate ${m.id} at Razorpay failed:`,
            e
          );
        }
      }
    }
    return { checked, changed };
  }

  /** Reads the token at Razorpay; used when a webhook may have been missed. */
  static async syncToken(
    mandate: SubscriptionMandate
  ): Promise<RzpToken | null> {
    if (!mandate.providerTokenId) return null;
    const token = (await razorpayClient.fetchToken(
      mandate.providerCustomerId,
      mandate.providerTokenId
    )) as RzpToken;
    const state = token.recurring_details?.status;
    if (state === 'confirmed') await AutoPayService.activate(mandate);
    else if (state === 'rejected') {
      await AutoPayService.markFailed(
        mandate.id,
        token.recurring_details?.failure_reason ?? 'Approval was declined'
      );
    } else if (state === 'cancelled' || state === 'cancellation_initiated') {
      await AutoPayService.setStatus(mandate.id, 'cancelled');
    } else if (state === 'paused') {
      await AutoPayService.setStatus(mandate.id, 'paused');
    }
    return token;
  }

  /** One active mandate per clinic: a new approval replaces the old one, which is stopped at Razorpay. */
  private static async activate(mandate: SubscriptionMandate) {
    if (mandate.status === 'active') return;
    const now = new Date();
    const replaced = await database.transaction(async (tx) => {
      const old = await tx
        .update(SubscriptionMandateModel)
        .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(SubscriptionMandateModel.ownerType, mandate.ownerType),
            eq(SubscriptionMandateModel.ownerId, mandate.ownerId),
            eq(SubscriptionMandateModel.status, 'active'),
            ne(SubscriptionMandateModel.id, mandate.id)
          )
        )
        .returning();
      await tx
        .update(SubscriptionMandateModel)
        .set({
          status: 'active',
          authorizedAt: now,
          failureReason: null,
          updatedAt: now,
        })
        .where(eq(SubscriptionMandateModel.id, mandate.id));
      return old;
    });
    await AutoPayService.tell(mandate, true);
    for (const m of replaced) {
      if (!m.providerTokenId) continue;
      await razorpayClient
        .stopToken(m.providerCustomerId, m.providerTokenId, m.method)
        .catch((e) =>
          logger.error(`[AutoPay] Stopping replaced mandate ${m.id} failed:`, e)
        );
    }
  }

  private static async markFailed(id: string, reason: string) {
    await database
      .update(SubscriptionMandateModel)
      .set({
        status: 'failed',
        failureReason: reason.slice(0, 255),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(SubscriptionMandateModel.id, id),
          ne(SubscriptionMandateModel.status, 'active')
        )
      );
  }

  private static async setStatus(id: string, status: 'cancelled' | 'paused') {
    const now = new Date();
    const [was] = await database
      .update(SubscriptionMandateModel)
      .set({
        status,
        ...(status === 'cancelled' ? { cancelledAt: now } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(SubscriptionMandateModel.id, id),
          eq(SubscriptionMandateModel.status, 'active')
        )
      )
      .returning();
    if (was) await AutoPayService.tell(was, false, AutoPayService.BANK_OFF);
  }

  private static readonly BANK_OFF =
    'It was cancelled or paused from your bank or UPI app.';

  /** Emails the clinic owner that AutoPay turned on or off; once per approval and direction. */
  private static async tell(
    mandate: SubscriptionMandate,
    on: boolean,
    reason?: string
  ) {
    try {
      const current = on
        ? null
        : await OwnerSubscriptionService.getCurrent('clinic', mandate.ownerId);
      await subscriptionNotify(
        'subscription.autopay_changed',
        {
          clinicId: mandate.ownerId,
          on,
          maxAmount: on ? fromPaise(mandate.maxAmountPaise) : null,
          // The Super Admin note is internal; the clinic only sees who turned it off.
          reason: on
            ? null
            : reason?.startsWith('Turned off by Super Admin')
              ? 'Turned off by the MediArogya team.'
              : (reason ?? null),
          renewBy:
            current?.subscription?.currentPeriodEnd?.toISOString() ?? null,
        },
        `${mandate.id}|${on ? 'on' : 'off'}`
      );
    } catch (e) {
      logger.error(
        `[AutoPay] Could not email the AutoPay change for mandate ${mandate.id}:`,
        e
      );
    }
  }

  static async byId(id: string) {
    const [row] = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(eq(SubscriptionMandateModel.id, id))
      .limit(1);
    return row ?? null;
  }

  private static async latestOpen(clinicId: string) {
    const [row] = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          eq(SubscriptionMandateModel.ownerId, clinicId),
          inArray(SubscriptionMandateModel.status, [
            'active',
            'pending',
            'paused',
            'failed',
          ])
        )
      )
      .orderBy(desc(SubscriptionMandateModel.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** One Razorpay customer per clinic, reused across approvals. */
  private static async customerFor(clinicId: string, email?: string) {
    const [known] = await database
      .select({ id: SubscriptionMandateModel.providerCustomerId })
      .from(SubscriptionMandateModel)
      .where(
        and(
          eq(SubscriptionMandateModel.ownerType, 'clinic'),
          eq(SubscriptionMandateModel.ownerId, clinicId)
        )
      )
      .orderBy(desc(SubscriptionMandateModel.createdAt))
      .limit(1);
    if (known) return known.id;
    const clinic = (await getClinicPort().getClinics([clinicId])).get(clinicId);
    const customer = await razorpayClient.createCustomer({
      name: clinic?.name ?? 'Clinic',
      email,
      contact: clinic?.phone ?? undefined,
      notes: { clinicId },
    });
    return customer.id;
  }
}
