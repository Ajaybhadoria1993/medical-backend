import { and, eq } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { fromPaise } from '../../../money';
import { razorpayClient } from '../../gateway/razorpay.client';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import {
  SubscriptionInvoiceModel,
  SubscriptionPaymentModel,
} from '../../models/subscriptionPayment.model';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { AutoPayService } from './autoPay.service';
import { BillingReadService } from './billingRead.service';
import { PaymentsService } from './payments.service';
import { MAX_EXTEND_DAYS } from '../../utils/autoPay.utils';
import { DAY_MS as DAY } from '../../utils/billingChecks.utils';
import type { BillingActor as Actor } from '../../types/billingAdmin.types';

/** Super Admin money tools (Q3): each needs a reason, kept on the clinic's billing timeline. */
export class BillingAdminService {
  /** Full refund of a paid payment; done when Razorpay confirms, which issues the credit note and takes back a pack or add-on. */
  static async refund(clinicId: string, paymentId: string, by: Actor) {
    const row = await BillingAdminService.payment(clinicId, paymentId);
    if (row.status !== 'captured' || !row.providerPaymentId) {
      throw new HttpError(409, 'Only a paid payment can be refunded.');
    }
    // Already started: finish it (Razorpay is asked first, so money never goes back twice).
    if (row.needsRefund) {
      await PaymentsService.refundDuplicate(row);
      return BillingReadService.clinic(clinicId);
    }
    const refund = (await razorpayClient.refundPayment(row.providerPaymentId, {
      reason: by.reason.slice(0, 200),
      paymentRowId: row.id,
      by: by.userId,
    })) as { status?: string };
    // Refund pending: who and why are kept for the credit note; the daily check watches it.
    const [pending] = await database
      .update(SubscriptionPaymentModel)
      .set({
        needsRefund: true,
        reason: by.reason.slice(0, 255),
        doneBy: by.userId,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionPaymentModel.id, row.id))
      .returning();
    // The money is already on its way back; a failed credit note step is finished by Retry in Billing checks.
    if (refund?.status === 'processed') {
      await PaymentsService.completeRefund(pending!).catch((e) =>
        logger.error(
          `[BillingAdmin] Refund ${row.id} sent, but completing it failed:`,
          e
        )
      );
    }
    await SubscriptionActivityService.record({
      clinicId,
      type: 'payment_refunded',
      title: `Refund of ₹${fromPaise(row.amountPaise)} started`,
      description: by.reason,
      amount: fromPaise(row.amountPaise),
      actorUserId: by.userId,
      metadata: { paymentId: row.id, transactionId: row.providerPaymentId },
    });
    logger.warn(
      `[BillingAdmin] Payment ${row.id} of clinic ${clinicId} refunded by ${by.userId}`
    );
    return BillingReadService.clinic(clinicId);
  }

  /** Adds days to the current paid plan; AutoPay and reminders follow the new end date. */
  static async extend(clinicId: string, days: number, by: Actor) {
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXTEND_DAYS) {
      throw new HttpError(400, `Extend by 1 to ${MAX_EXTEND_DAYS} days.`);
    }
    const current = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const sub = current?.subscription;
    if (
      !current?.state.isValid ||
      current.plan.kind !== 'paid' ||
      !sub?.currentPeriodEnd
    ) {
      throw new HttpError(409, 'Only a running paid plan can be extended.');
    }
    const end = new Date(sub.currentPeriodEnd.getTime() + days * DAY);
    await database
      .update(SubscriptionModel)
      .set({
        currentPeriodEnd: end,
        status: sub.status === 'past_due' ? 'active' : sub.status,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionModel.id, sub.id));
    await LimitationService.invalidateClinicCache(clinicId);
    await SubscriptionActivityService.record({
      clinicId,
      type: 'plan_extended',
      title: `${current.plan.name} extended by ${days} day${days === 1 ? '' : 's'}`,
      description: by.reason,
      actorUserId: by.userId,
      metadata: { subscriptionId: sub.id, from: sub.currentPeriodEnd, to: end },
    });
    await subscriptionNotify(
      'subscription.plan_extended',
      {
        clinicId,
        planName: current.plan.name,
        days,
        endsAt: end.toISOString(),
      },
      `${sub.id}|${end.getTime()}`
    );
    return { endsAt: end, ...(await BillingReadService.clinic(clinicId)) };
  }

  /** Turns the clinic's AutoPay off here and at Razorpay. */
  static async cancelAutoPay(clinicId: string, by: Actor) {
    const stopped = await AutoPayService.stop(
      clinicId,
      `Turned off by Super Admin: ${by.reason}`
    );
    if (!stopped)
      throw new HttpError(409, 'This clinic has no AutoPay to turn off.');
    await SubscriptionActivityService.record({
      clinicId,
      type: 'autopay_disabled',
      title: 'AutoPay turned off by Super Admin',
      description: by.reason,
      actorUserId: by.userId,
    });
    return BillingReadService.clinic(clinicId);
  }

  /** Sends the payment's receipt email again, with its stored invoice attached. */
  static async resendInvoice(clinicId: string, invoiceId: string, by: Actor) {
    const [inv] = await database
      .select({
        id: SubscriptionInvoiceModel.id,
        paymentId: SubscriptionInvoiceModel.paymentId,
      })
      .from(SubscriptionInvoiceModel)
      .where(
        and(
          eq(SubscriptionInvoiceModel.id, invoiceId),
          eq(SubscriptionInvoiceModel.ownerId, clinicId)
        )
      )
      .limit(1);
    if (!inv)
      throw new HttpError(404, 'This invoice was not found for this clinic.');
    const row = await BillingAdminService.payment(clinicId, inv.paymentId);
    const items = row.lines.items.filter((l) => l.kind !== 'coupon');
    const amount = Number(fromPaise(row.amountPaise));
    const plan = items.find((l) => l.kind === 'plan');
    // A new dedupe key each time: a resend is meant to go out again.
    const key = `resend|${inv.id}|${Date.now()}`;
    if (plan) {
      await subscriptionNotify(
        'subscription.payment_receipt',
        {
          clinicId,
          planName: plan.description,
          amount: String(amount),
          transactionId: row.providerPaymentId ?? '',
          billingCycle: plan.billingCycle,
          invoiceId: inv.id,
        },
        key
      );
    } else {
      await subscriptionNotify(
        'subscription.addon_receipt',
        {
          clinicId,
          transactionId: row.providerPaymentId ?? '',
          invoiceId: inv.id,
          totalAmount: amount,
          items: items.map((l) => ({
            name: l.description,
            quantity: l.quantity ?? 1,
            billingCycle: l.billingCycle ?? 'one-time',
            amount: Number(fromPaise(l.amountPaise)),
          })),
        },
        key
      );
    }
    await SubscriptionActivityService.record({
      clinicId,
      type: 'invoice_resent',
      title: 'Invoice email sent again',
      description: by.reason,
      actorUserId: by.userId,
      metadata: { invoiceId: inv.id, paymentId: row.id },
    });
  }

  private static async payment(clinicId: string, paymentId: string) {
    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.id, paymentId),
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId)
        )
      )
      .limit(1);
    if (!row)
      throw new HttpError(404, 'This payment was not found for this clinic.');
    return row;
  }
}
