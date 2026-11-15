import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import logger from '../../../../utils/logger';
import { HttpError } from '../../../../middlewear/errorHandler';
import { razorpayClient } from '../../gateway/razorpay.client';
import {
  SubscriptionMandateModel,
  type SubscriptionMandate,
} from '../../models/subscriptionMandate.model';
import { SubscriptionPaymentModel } from '../../models/subscriptionPayment.model';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { AutoPayService } from './autoPay.service';
import { PlanPricingService } from './planPricing.service';
import type { RenewalOutcome } from '../../types/autoPay.types';
import {
  CHARGE_FROM_HOURS,
  LAST_START_HOURS,
  NOTICE_HOURS,
} from '../../utils/autoPay.utils';
import {
  DAY_MS as DAY,
  HOUR_MS as HOUR,
} from '../../utils/billingChecks.utils';
import { getClinicPort } from '../../ports';
import { GRACE_DAYS } from '../../utils/subscriptionState.utils';

export type { RenewalOutcome } from '../../types/autoPay.types';

/** Daily: charges AutoPay clinics plan + add-ons for the next month; the webhook extends the period. */
export class AutoPayRenewalService {
  /** The first charge and two retries; then the clinic pays by hand or moves to Free when grace ends. */
  static readonly MAX_TRIES = 3;

  static async run(now = new Date()) {
    const tally: Partial<Record<RenewalOutcome, number>> = {};
    for (let after: string | null = null; ;) {
      const mandates = await AutoPayService.mandatePage(['active'], after);
      if (!mandates.length) break;
      after = mandates[mandates.length - 1]!.id;
      for (const mandate of mandates) {
        const outcome = await AutoPayRenewalService.renew(mandate, now).catch(
          (e) => {
            logger.error(
              `[AutoPay] Renewal for clinic ${mandate.ownerId} failed:`,
              e
            );
            return 'failed' as const;
          }
        );
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      }
    }
    logger.info(`[AutoPay] Renewal run: ${JSON.stringify(tally)}`);
    return tally;
  }

  static async renew(
    mandate: SubscriptionMandate,
    now: Date
  ): Promise<RenewalOutcome> {
    const clinicId = mandate.ownerId;
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId,
      now
    );
    const sub = current?.subscription;
    // A plan set to end or change at period end is settled by the period-end job, not charged.
    if (
      !current?.state.isValid ||
      current.plan.kind !== 'paid' ||
      !sub ||
      // A trial is charged at its end like a monthly plan.
      (sub.billingCycle !== 'monthly' && !sub.isTrial) ||
      !sub.currentPeriodEnd ||
      sub.cancelAtPeriodEnd ||
      // A switch to a yearly plan is paid by hand; AutoPay is monthly only.
      (sub.scheduledPlanId && sub.scheduledBillingCycle !== 'monthly') ||
      !mandate.providerTokenId
    ) {
      return 'not_eligible';
    }
    const msLeft = sub.currentPeriodEnd.getTime() - now.getTime();
    const tries = await AutoPayRenewalService.failedTries(
      clinicId,
      sub.currentPeriodEnd
    );
    if (tries >= AutoPayRenewalService.MAX_TRIES) return 'gave_up';
    // Retries run on through the grace days; a pending charge keeps access (decision L).
    const latest = tries > 0 ? -GRACE_DAYS * DAY : LAST_START_HOURS * HOUR;
    if (msLeft > CHARGE_FROM_HOURS * HOUR || msLeft <= latest) return 'not_due';

    // One charge per period: a started, pending or paid renewal for this period stops a second one.
    const [started] = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.periodStart, sub.currentPeriodEnd),
          inArray(SubscriptionPaymentModel.status, [
            'created',
            'pending',
            'captured',
          ])
        )
      )
      .limit(1);
    if (started) return 'already_started';

    const quote = await PlanPricingService.quote({
      clinicId,
      // With a change scheduled, the next month is charged on the plan the clinic moves to.
      planId: sub.scheduledPlanId ?? current.plan.id,
      cycle: 'monthly',
      now,
    });
    if (quote.amountPaise > mandate.maxAmountPaise) {
      // Step 5 asks the clinic to approve a higher limit; until then they renew by paying.
      logger.warn(
        `[AutoPay] Clinic ${clinicId}: renewal ${quote.amountPaise} is above the AutoPay limit ${mandate.maxAmountPaise}`
      );
      return 'above_limit';
    }

    const attempt = tries + 1;
    const [row] = await database
      .insert(SubscriptionPaymentModel)
      .values({
        ownerType: 'clinic',
        ownerId: clinicId,
        kind: 'renewal',
        subscriptionId: quote.subscriptionId,
        periodStart: quote.periodStart,
        periodEnd: quote.periodEnd,
        status: 'created',
        amountPaise: quote.amountPaise,
        discountPaise: 0,
        // GST in force on the charge day, frozen for the invoice.
        taxRateBp: quote.tax.rateBp,
        taxMode: quote.tax.mode,
        lines: { version: 1, items: quote.items },
        provider: 'razorpay',
        mandateId: mandate.id,
        // Same key for the same period and try, so a second run or instance cannot charge twice.
        idempotencyKey: `ap:${sub.id}:${Math.floor(sub.currentPeriodEnd.getTime() / 1000)}:${attempt}`,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return 'already_started';

    try {
      const order = await razorpayClient.createRecurringOrder({
        amountPaise: row.amountPaise,
        tokenId: mandate.providerTokenId,
        chargeAfter: new Date(now.getTime() + NOTICE_HOURS * 60 * 60 * 1000),
        receipt: row.id,
        notes: { paymentId: row.id, clinicId, kind: 'renewal' },
      });
      await database
        .update(SubscriptionPaymentModel)
        .set({ providerOrderId: order.id, updatedAt: new Date() })
        .where(eq(SubscriptionPaymentModel.id, row.id));
    } catch (e) {
      // The order never reached Razorpay: this try failed, and a retry may run later.
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'failed',
          failureReason: String((e as Error).message ?? e).slice(0, 255),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionPaymentModel.id, row.id));
      throw e;
    }
    // Razorpay now sends the pre-debit notice; the charge waits for it (order.notification.delivered).
    return 'notice_sent';
  }

  /** Charges a renewal 26 h after its pre-debit notice (RBI rule; earlier is refused).
   *  Called by the hourly AutoPay job and the notice webhook; too early leaves it waiting. */
  static async chargeAfterNotice(
    paymentRowId: string
  ): Promise<'charged' | 'waiting' | 'skipped'> {
    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.id, paymentRowId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.status, 'created'),
          isNotNull(SubscriptionPaymentModel.providerOrderId),
          isNotNull(SubscriptionPaymentModel.mandateId)
        )
      )
      .limit(1);
    if (!row) return 'skipped';
    const [mandate] = await database
      .select()
      .from(SubscriptionMandateModel)
      .where(eq(SubscriptionMandateModel.id, row.mandateId!))
      .limit(1);
    // AutoPay was turned off after the notice: nothing is charged, and the clinic pays by hand.
    if (!mandate?.providerTokenId || mandate.status !== 'active') {
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'abandoned',
          failureReason: 'AutoPay was turned off before the charge',
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionPaymentModel.id, row.id));
      return 'skipped';
    }
    // Razorpay allows the debit only 25 h after the notice is delivered; the order asked for 26 h.
    if (Date.now() < row.createdAt.getTime() + NOTICE_HOURS * HOUR)
      return 'waiting';
    const clinicId = row.ownerId;
    try {
      const contact = await AutoPayRenewalService.contactOf(clinicId);
      const charge = await razorpayClient.chargeToken({
        orderId: row.providerOrderId!,
        customerId: mandate.providerCustomerId,
        tokenId: mandate.providerTokenId,
        amountPaise: row.amountPaise,
        email: contact.email,
        contact: contact.phone,
        description: 'Subscription renewal',
        notes: { paymentId: row.id, clinicId },
      });
      // Only while still 'created': payment.captured can land before this line, and pending would undo it.
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'pending',
          providerPaymentId: charge.paymentId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(SubscriptionPaymentModel.id, row.id),
            eq(SubscriptionPaymentModel.status, 'created')
          )
        );
      return 'charged';
    } catch (e) {
      const reason = String((e as Error).message ?? e);
      // Razorpay has not sent the notice yet: leave the row waiting for the webhook or the next try.
      if (/pre-debit notification|after the notification/i.test(reason))
        return 'waiting';
      // callRazorpaySdk turns Razorpay's answer into HttpError.status (4xx = refused); no answer may have gone through.
      const status = e instanceof HttpError ? e.status : undefined;
      const refused =
        (status !== undefined && status >= 400 && status < 500) ||
        (e instanceof Error && e.message.includes('authentication failed'));
      await database
        .update(SubscriptionPaymentModel)
        .set(
          refused
            ? {
                status: 'failed',
                failureReason: reason.slice(0, 255),
                updatedAt: new Date(),
              }
            : {
                status: 'pending',
                failureReason: `Outcome unknown: ${reason}`.slice(0, 255),
                updatedAt: new Date(),
              }
        )
        .where(
          and(
            eq(SubscriptionPaymentModel.id, row.id),
            eq(SubscriptionPaymentModel.status, 'created')
          )
        );
      if (!refused) {
        logger.warn(
          `[AutoPayRenewal] Charge for payment ${row.id} sent but unanswered; kept pending:`,
          e
        );
        return 'charged';
      }
      throw e;
    }
  }

  /** Razorpay's pre-debit notice webhooks: delivered → charge now; failed → this try failed (retried later). */
  static async onNoticeEvent(event: string, orderId: string | undefined) {
    if (!orderId) return;
    const [row] = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.providerOrderId, orderId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.status, 'created')
        )
      )
      .limit(1);
    if (!row) return;
    if (event === 'order.notification.delivered') {
      await AutoPayRenewalService.chargeAfterNotice(row.id);
    } else if (event === 'order.notification.failed') {
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'failed',
          failureReason: 'The pre-debit notice could not be delivered',
          updatedAt: new Date(),
        })
        // Still 'created' only: a charge that started meanwhile keeps its own status.
        .where(
          and(
            eq(SubscriptionPaymentModel.id, row.id),
            eq(SubscriptionPaymentModel.status, 'created')
          )
        );
    }
  }

  /** Fallback when the notice webhook is missed: renewals still waiting are charged once Razorpay allows it. */
  static async chargeWaiting(clinicId?: string) {
    const rows = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.status, 'created'),
          isNotNull(SubscriptionPaymentModel.providerOrderId),
          isNotNull(SubscriptionPaymentModel.mandateId),
          clinicId ? eq(SubscriptionPaymentModel.ownerId, clinicId) : undefined
        )
      );
    let charged = 0;
    for (const r of rows) {
      try {
        if ((await AutoPayRenewalService.chargeAfterNotice(r.id)) === 'charged')
          charged++;
      } catch (e) {
        logger.error(
          `[AutoPayRenewal] Charging waiting renewal ${r.id} failed:`,
          e
        );
      }
    }
    return { waiting: rows.length, charged };
  }

  /** AutoPay charges for this period that the bank declined; each retry is a new try. */
  static async failedTries(clinicId: string, periodStart: Date) {
    const rows = await database
      .select({ id: SubscriptionPaymentModel.id })
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.kind, 'renewal'),
          eq(SubscriptionPaymentModel.periodStart, periodStart),
          eq(SubscriptionPaymentModel.status, 'failed'),
          isNotNull(SubscriptionPaymentModel.mandateId)
        )
      );
    return rows.length;
  }

  /** Razorpay needs an email and phone on each recurring charge: the clinic's owner and phone. */
  private static async contactOf(clinicId: string) {
    const contact = await getClinicPort().getOwnerContact(clinicId);
    if (!contact)
      throw new Error('Clinic has no email or phone for the AutoPay charge');
    return contact;
  }
}
