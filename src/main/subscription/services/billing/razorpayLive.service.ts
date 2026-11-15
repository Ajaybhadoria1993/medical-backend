import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { razorpayClient } from '../../gateway/razorpay.client';
import { SubscriptionMandateModel as M } from '../../models/subscriptionMandate.model';
import { SubscriptionPaymentModel as P } from '../../models/subscriptionPayment.model';
import {
  compareMandate,
  comparePayment,
  paymentStateOf,
  type RazorpayPaymentState,
} from '../../utils/razorpayLive.utils';
import { AutoPayService, stateOfToken, type RzpToken } from './autoPay.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';

/** Razorpay's own fields for the screen; an allow-list, so customer email and phone never reach it. */
const pick = (o: unknown, keys: string[]) =>
  Object.fromEntries(
    keys
      .filter((k) => (o as Record<string, unknown>)?.[k] !== undefined)
      .map((k) => [k, (o as Record<string, unknown>)[k]])
  );
const TOKEN_FIELDS = [
  'id',
  'method',
  'recurring',
  'recurring_details',
  'max_amount',
  'expired_at',
  'created_at',
  'used_at',
];
const PAYMENT_FIELDS = [
  'id',
  'status',
  'amount',
  'amount_refunded',
  'refund_status',
  'method',
  'captured',
  'error_code',
  'error_description',
  'created_at',
];
const errorOf = (e: unknown) => ({ error: String((e as Error)?.message ?? e) });

/** Super Admin: one clinic's AutoPay compared with Razorpay now and synced; one payment read from Razorpay on demand. */
export class RazorpayLiveService {
  static async check(clinicId: string) {
    const mandates = await database
      .select()
      .from(M)
      .where(
        and(
          eq(M.ownerType, 'clinic'),
          eq(M.ownerId, clinicId),
          isNotNull(M.providerTokenId)
        )
      )
      .orderBy(desc(M.createdAt))
      .limit(5);

    const autoPay = await Promise.all(
      mandates.map(async (m) => {
        try {
          const token = (await razorpayClient.fetchToken(
            m.providerCustomerId,
            m.providerTokenId!
          )) as RzpToken;
          const theirs = stateOfToken(token);
          return {
            mandateId: m.id,
            customerId: m.providerCustomerId,
            tokenId: m.providerTokenId,
            ours: m.status,
            razorpay: token.recurring_details?.status ?? 'unknown',
            ...compareMandate(m.status, theirs),
            response: pick(token, TOKEN_FIELDS),
          };
        } catch (e) {
          // A deleted token (how a card AutoPay is stopped) no longer exists: that is "off" at Razorpay.
          if (String((e as Error)?.message).includes('does not exist')) {
            return {
              mandateId: m.id,
              customerId: m.providerCustomerId,
              tokenId: m.providerTokenId,
              ours: m.status,
              razorpay: 'removed',
              match: m.status !== 'active',
              action: null,
              response: {
                note: 'Token deleted at Razorpay: a card AutoPay is stopped by deleting its token, so no more charges.',
                ...errorOf(e),
              },
            };
          }
          logger.warn(
            `[RazorpayLive] Token check failed for mandate ${m.id}:`,
            e
          );
          return {
            mandateId: m.id,
            customerId: m.providerCustomerId,
            tokenId: m.providerTokenId,
            ours: m.status,
            razorpay: 'unknown',
            match: true,
            action: null,
            response: errorOf(e),
          };
        }
      })
    );

    return {
      checkedAt: new Date(),
      autoPay,
      differences: autoPay.filter((a) => !a.match).length,
      // Razorpay did not answer for these, so they could not be compared.
      unchecked: autoPay.filter((a) => a.razorpay === 'unknown').length,
    };
  }

  /** One payment as Razorpay has it (on click in the Payments table); read only. */
  static async checkPayment(clinicId: string, paymentId: string) {
    const [p] = await database
      .select()
      .from(P)
      .where(
        and(
          eq(P.id, paymentId),
          eq(P.ownerType, 'clinic'),
          eq(P.ownerId, clinicId)
        )
      )
      .limit(1);
    if (!p)
      throw new HttpError(404, 'This payment was not found for this clinic.');
    if (!p.providerOrderId) {
      return {
        ours: p.status,
        razorpay: 'not_paid' as RazorpayPaymentState,
        match: true,
        action: null,
        response: null,
      };
    }
    try {
      const { items } = await razorpayClient.orderPayments(p.providerOrderId);
      const razorpay = paymentStateOf(items, p.amountPaise);
      return {
        ours: p.status,
        razorpay,
        ...comparePayment(p.status, razorpay, p.kind),
        response: {
          order: p.providerOrderId,
          items: items.map((i) => pick(i, PAYMENT_FIELDS)),
        },
      };
    } catch (e) {
      logger.warn(`[RazorpayLive] Order check failed for payment ${p.id}:`, e);
      return {
        ours: p.status,
        razorpay: 'unknown' as RazorpayPaymentState,
        match: true,
        action: null,
        response: errorOf(e),
      };
    }
  }

  /** Makes AutoPay match Razorpay: off here but live there is cancelled there; anything else follows Razorpay. */
  static async sync(clinicId: string, by: { userId: string; reason: string }) {
    const report = await RazorpayLiveService.check(clinicId);
    let fixed = 0;
    for (const a of report.autoPay.filter((x) => !x.match)) {
      const mandate = await AutoPayService.byId(a.mandateId);
      if (!mandate?.providerTokenId) continue;
      if (a.action === 'cancel_at_razorpay') {
        // Turned off here: finish the cancel at Razorpay rather than turning ours back on.
        await razorpayClient.stopToken(
          mandate.providerCustomerId,
          mandate.providerTokenId,
          mandate.method
        );
      } else {
        await AutoPayService.syncToken(mandate);
      }
      fixed++;
    }
    await SubscriptionActivityService.record({
      clinicId,
      type: 'billing_synced',
      title: `AutoPay synced with Razorpay (${fixed} fixed)`,
      description: by.reason,
      actorUserId: by.userId,
      metadata: { fixed },
    });
    logger.warn(
      `[RazorpayLive] Clinic ${clinicId} AutoPay synced with Razorpay by ${by.userId}: ${fixed} fixed`
    );
    return { fixed, ...(await RazorpayLiveService.check(clinicId)) };
  }
}
