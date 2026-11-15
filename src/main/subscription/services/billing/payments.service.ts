import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { formatISTDate } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import { verifyRazorpayPayment } from '../../../../utils/razorpay';
import { fromPaise } from '../../../money';
import {
  grantPurchasedCredits,
  revokePurchasedCredits,
  type CreditType,
} from '../../../credits';
import { razorpayClient } from '../../gateway/razorpay.client';
import { CouponModel } from '../../models/coupon.model';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
} from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import {
  SubscriptionInvoiceModel,
  SubscriptionPaymentModel,
  type SubscriptionPayment,
} from '../../models/subscriptionPayment.model';
import { activationOutcome } from '../../utils/activation.utils';
import { ensurePaymentCaptured } from '../../utils/razorpayOrder.utils';
import { anchorDayOf, nextPeriodEnd } from '../../utils/renewalDate.utils';
import { renewalCaptureFields } from '../../utils/renewalCapture.utils';
import { subscriptionState } from '../../utils/subscriptionState.utils';
import { LimitationService } from '../limitation.service';
import { SubscriptionActivityService } from '../subscriptionActivity.service';
import { AddOnChangeService } from '../core/addOnChange.service';
import { AutoPayService } from './autoPay.service';
import { InvoiceService } from './invoice.service';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { Tx } from '../../types/db.types';

const CURRENT = ['trialing', 'active', 'past_due'] as const;

type Applied =
  | {
      kind: 'applied';
      payment: SubscriptionPayment;
      subscriptionId: string | null;
      planName: string;
      couponFull: boolean;
      invoiceId: string | null;
      addOnChanges?: { applied: number; archive: string[] };
    }
  | { kind: 'already'; payment: SubscriptionPayment }
  | { kind: 'duplicate'; payment: SubscriptionPayment };

/** Turns a captured payment into a plan exactly once, however many times it is reported. */
export class PaymentsService {
  static async findByOrder(clinicId: string, orderId: string) {
    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.providerOrderId, orderId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** Checkout's success callback: the signature proves the pair; the amount must match our row exactly. */
  static async verifyCheckout(input: {
    payment: SubscriptionPayment;
    providerPaymentId: string;
    signature: string;
  }) {
    const orderId = input.payment.providerOrderId;
    if (
      !orderId ||
      !verifyRazorpayPayment(orderId, input.providerPaymentId, input.signature)
    ) {
      throw new HttpError(400, 'Invalid payment signature');
    }
    const captured = await ensurePaymentCaptured({
      paymentId: input.providerPaymentId,
      orderId,
      captureIfAuthorized: true,
      acceptRefunded: input.payment.kind === 'mandate_setup',
    });
    if (Number(captured.amount) !== input.payment.amountPaise) {
      logger.error(
        `[Payments] Amount mismatch on ${input.payment.id}: paid ${captured.amount}, expected ${input.payment.amountPaise}`
      );
      throw new HttpError(
        400,
        'The amount paid does not match this checkout. Please contact support.'
      );
    }
    return PaymentsService.activatePayment({
      paymentRowId: input.payment.id,
      providerPaymentId: input.providerPaymentId,
      method: captured.method ?? null,
    });
  }

  static async activatePayment(input: {
    paymentRowId: string;
    providerPaymentId: string | null;
    method?: string | null;
  }) {
    const now = new Date();
    const result: Applied = await database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(SubscriptionPaymentModel)
        .where(eq(SubscriptionPaymentModel.id, input.paymentRowId))
        .for('update');
      if (!row) throw new HttpError(404, 'Payment not found');

      // Locks the owner's current plan, so two payments for one owner apply one after the other.
      const [current] = await tx
        .select({
          id: SubscriptionModel.id,
          status: SubscriptionModel.status,
          isTrial: SubscriptionModel.isTrial,
          cancelAtPeriodEnd: SubscriptionModel.cancelAtPeriodEnd,
          cancelledAt: SubscriptionModel.cancelledAt,
          currentPeriodEnd: SubscriptionModel.currentPeriodEnd,
          billingAnchorDay: SubscriptionModel.billingAnchorDay,
          planKind: SubscriptionPlanModel.kind,
          planId: SubscriptionPlanModel.id,
          scheduledPlanId: SubscriptionModel.scheduledPlanId,
        })
        .from(SubscriptionModel)
        .innerJoin(
          PlanVersionModel,
          eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
        )
        .innerJoin(
          SubscriptionPlanModel,
          eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
        )
        .where(
          and(
            eq(SubscriptionModel.ownerType, row.ownerType),
            eq(SubscriptionModel.ownerId, row.ownerId),
            inArray(SubscriptionModel.status, [...CURRENT])
          )
        )
        .for('update', { of: SubscriptionModel });
      const valid = !!current && subscriptionState(current, now).isValid;
      // A purchase clashes with a paid plan; a change or renewal with any change to the plan it was priced on.
      // A credit pack does not depend on the plan, so it never clashes.
      const conflict =
        row.kind === 'credit_purchase' || row.kind === 'mandate_setup'
          ? false
          : row.kind === 'plan_purchase'
            ? valid && !current!.isTrial && current!.planKind === 'paid'
            : !valid ||
              current!.id !== row.subscriptionId ||
              (row.kind === 'renewal' &&
                current!.currentPeriodEnd?.getTime() !==
                  row.periodStart?.getTime());

      const captured = {
        status: 'captured' as const,
        providerPaymentId: input.providerPaymentId,
        paymentMethod: input.method ?? null,
        paidAt: now,
        updatedAt: now,
      };
      // An AutoPay try marked failed can still be captured by the bank later; it is applied, not refused.
      const lateAutoPay = row.status === 'failed' && !!row.mandateId;
      const outcome = activationOutcome(
        lateAutoPay ? { ...row, status: 'pending' } : row,
        input.providerPaymentId,
        conflict
      );

      if (outcome === 'not_open') {
        throw new HttpError(409, 'This checkout is no longer open.');
      }
      if (outcome === 'already_applied')
        return { kind: 'already', payment: row };
      if (outcome === 'duplicate') {
        if (row.status === 'captured' || row.status === 'refunded') {
          // A second Razorpay payment on an order we already applied gets its own row.
          const [extra] = await tx
            .insert(SubscriptionPaymentModel)
            .values({
              ...captured,
              ownerType: row.ownerType,
              ownerId: row.ownerId,
              kind: row.kind,
              amountPaise: row.amountPaise,
              discountPaise: row.discountPaise,
              taxRateBp: row.taxRateBp,
              taxMode: row.taxMode,
              currency: row.currency,
              lines: row.lines,
              provider: row.provider,
              needsRefund: true,
              failureReason: `Second payment on order ${row.providerOrderId}`,
            })
            .returning();
          return { kind: 'duplicate', payment: extra! };
        }
        const [flagged] = await tx
          .update(SubscriptionPaymentModel)
          .set({ ...captured, needsRefund: true })
          .where(eq(SubscriptionPaymentModel.id, row.id))
          .returning();
        return { kind: 'duplicate', payment: flagged! };
      }

      // The AutoPay approval check is not a sale: no invoice, nothing applied to the plan.
      if (row.kind === 'mandate_setup') {
        const [payment] = await tx
          .update(SubscriptionPaymentModel)
          .set(captured)
          .where(eq(SubscriptionPaymentModel.id, row.id))
          .returning();
        return {
          kind: 'applied',
          payment: payment!,
          subscriptionId: current?.id ?? null,
          planName: 'AutoPay',
          couponFull: false,
          invoiceId: null,
        };
      }

      if (row.kind === 'credit_purchase') {
        const [payment] = await tx
          .update(SubscriptionPaymentModel)
          .set(captured)
          .where(eq(SubscriptionPaymentModel.id, row.id))
          .returning();
        // A pack bought from the add-ons screen may carry a coupon.
        if (row.couponId)
          await PaymentsService.claimCoupon(tx, row.couponId, now);
        const invoice = await InvoiceService.issue(tx, payment!);
        return {
          kind: 'applied',
          payment: payment!,
          subscriptionId: current?.id ?? null,
          planName:
            row.lines.items.find((l) => l.kind === 'credits')?.description ??
            'Credits',
          couponFull: false,
          invoiceId: invoice?.id ?? null,
        };
      }

      if (row.kind === 'addon_purchase') {
        const names: string[] = [];
        for (const l of row.lines.items) {
          if (l.kind !== 'addon' || !l.addOnId || !l.quantity) continue;
          names.push(l.description);
          // Buying more also withdraws a scheduled reduce on that add-on.
          await tx
            .insert(SubscriptionAddOnModel)
            .values({
              ownerType: row.ownerType,
              ownerId: row.ownerId,
              subscriptionId: current!.id,
              addOnId: l.addOnId,
              quantity: l.quantity,
            })
            .onConflictDoUpdate({
              target: [
                SubscriptionAddOnModel.subscriptionId,
                SubscriptionAddOnModel.addOnId,
              ],
              targetWhere: sql`${SubscriptionAddOnModel.status} = 'active'`,
              set: {
                quantity: sql`${SubscriptionAddOnModel.quantity} + ${l.quantity}`,
                scheduledQuantity: null,
                scheduledDeactivateUserIds: [],
                updatedAt: now,
              },
            });
        }
        const [payment] = await tx
          .update(SubscriptionPaymentModel)
          .set(captured)
          .where(eq(SubscriptionPaymentModel.id, row.id))
          .returning();
        const couponFull = row.couponId
          ? await PaymentsService.claimCoupon(tx, row.couponId, now)
          : false;
        const invoice = await InvoiceService.issue(tx, payment!);
        return {
          kind: 'applied',
          payment: payment!,
          subscriptionId: current!.id,
          planName: names.join(', '),
          couponFull,
          invoiceId: invoice?.id ?? null,
        };
      }

      const line = row.lines.items.find((l) => l.kind === 'plan');
      if (!line?.planVersionId || !line.billingCycle) {
        throw new HttpError(500, 'This payment has no plan line.');
      }
      const [plan] = await tx
        .select({ name: SubscriptionPlanModel.name })
        .from(PlanVersionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
        )
        .where(eq(PlanVersionModel.id, line.planVersionId))
        .limit(1);

      let subscriptionId: string;
      let periodStart: Date;
      let periodEnd: Date;
      let addOnChanges = { applied: 0, archive: [] as string[] };
      if (row.kind === 'renewal') {
        // A renewal extends the same row; renewing also withdraws a scheduled cancel.
        periodStart = row.periodStart!;
        periodEnd = row.periodEnd!;
        subscriptionId = current!.id;
        // Paid for the scheduled plan: keep this plan until the period starts, then applyPaidSwitches moves it.
        const [paidPlan] = await tx
          .select({ planId: PlanVersionModel.planId })
          .from(PlanVersionModel)
          .where(eq(PlanVersionModel.id, line.planVersionId))
          .limit(1);
        const switching =
          !!current!.scheduledPlanId &&
          paidPlan?.planId === current!.scheduledPlanId &&
          paidPlan.planId !== current!.planId;
        await tx
          .update(SubscriptionModel)
          .set({
            ...(switching
              ? {}
              : {
                  planVersionId: line.planVersionId,
                  billingCycle: line.billingCycle,
                }),
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            status: 'active',
            // Paying at a trial's end makes it the paid plan.
            isTrial: false,
            // Changes made after this renewal was charged were not priced into it, so they wait a period.
            ...renewalCaptureFields({
              cancelAtPeriodEnd: current!.cancelAtPeriodEnd,
              cancelledAt: current!.cancelledAt,
              scheduledPlanId: current!.scheduledPlanId,
              switching,
              chargedAt: row.createdAt,
              periodEnd,
            }),
            updatedAt: now,
          })
          .where(eq(SubscriptionModel.id, subscriptionId));
        // The renewal was priced on the scheduled quantities, so they take effect with it.
        addOnChanges = await AddOnChangeService.applyAtRenewal(
          tx,
          subscriptionId,
          row.createdAt
        );
      } else {
        if (current) {
          await tx
            .update(SubscriptionModel)
            .set({ status: 'replaced', endedAt: now, updatedAt: now })
            .where(eq(SubscriptionModel.id, current.id));
        }
        // An upgrade keeps the end date and renewal day it was priced on; a purchase or a switch starts today.
        const keepsPeriod = row.kind === 'plan_change' && !!row.periodEnd;
        const anchorDay = keepsPeriod
          ? (current?.billingAnchorDay ?? anchorDayOf(row.periodEnd!))
          : anchorDayOf(now);
        periodStart = now;
        periodEnd = keepsPeriod
          ? row.periodEnd!
          : nextPeriodEnd(now, line.billingCycle, anchorDay);
        const [created] = await tx
          .insert(SubscriptionModel)
          .values({
            ownerType: row.ownerType,
            ownerId: row.ownerId,
            planVersionId: line.planVersionId,
            status: 'active',
            billingCycle: line.billingCycle,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            billingAnchorDay: anchorDay,
          })
          .returning({ id: SubscriptionModel.id });
        subscriptionId = created!.id;
        // Add-ons bought on a trial carry into the plan bought from it.
        // ponytail: add-ons paid to the trial end run free until the new renewal; bill the gap if it matters.
        if ((row.kind === 'plan_change' || current?.isTrial) && current) {
          await tx
            .update(SubscriptionAddOnModel)
            .set({ subscriptionId, updatedAt: now })
            .where(
              and(
                eq(SubscriptionAddOnModel.subscriptionId, current.id),
                eq(SubscriptionAddOnModel.status, 'active')
              )
            );
        }
      }
      const [payment] = await tx
        .update(SubscriptionPaymentModel)
        .set({ ...captured, subscriptionId, periodStart, periodEnd })
        .where(eq(SubscriptionPaymentModel.id, row.id))
        .returning();

      const couponFull = row.couponId
        ? await PaymentsService.claimCoupon(tx, row.couponId, now)
        : false;
      const invoice = await InvoiceService.issue(tx, payment!);
      return {
        kind: 'applied',
        payment: payment!,
        subscriptionId,
        planName: plan?.name ?? line.description,
        couponFull,
        invoiceId: invoice?.id ?? null,
        addOnChanges,
      };
    });

    if (result.kind === 'duplicate') {
      await PaymentsService.refundDuplicate(result.payment);
      return { ...result, staffReactivated: 0, doctorsReactivated: 0 };
    }
    if (result.kind === 'already') {
      if (result.payment.mandateId && result.payment.kind !== 'renewal') {
        await AutoPayService.afterPayment(result.payment);
      }
      // A repeat report heals a crash between the payment and the credits.
      if (
        result.payment.status === 'captured' &&
        result.payment.lines.items.some((l) => l.kind === 'credits')
      ) {
        await PaymentsService.addPurchasedCredits(result.payment);
      }
      return { ...result, staffReactivated: 0, doctorsReactivated: 0 };
    }

    const { payment } = result;
    const clinicId = payment.ownerId;
    // A payment that also approved AutoPay keeps its token; the approval check stops here.
    if (payment.mandateId && payment.kind !== 'renewal') {
      await AutoPayService.afterPayment(payment);
    }
    if (payment.kind === 'mandate_setup') {
      return { ...result, staffReactivated: 0, doctorsReactivated: 0 };
    }
    const planLine = payment.lines.items.find((l) => l.kind === 'plan');
    // AutoPay is monthly only: any paid move onto a yearly plan (incl. a renewal into a scheduled yearly switch) ends it.
    if (
      (payment.kind === 'plan_purchase' ||
        payment.kind === 'plan_change' ||
        payment.kind === 'renewal') &&
      planLine?.billingCycle === 'yearly'
    ) {
      await AutoPayService.stop(clinicId, 'Moved to a yearly plan');
    }
    // An add-on order can carry a WhatsApp pack; its credits come from the same payment.
    if (
      payment.kind !== 'credit_purchase' &&
      payment.lines.items.some((l) => l.kind === 'credits')
    ) {
      await PaymentsService.addPurchasedCredits(payment);
    }
    if (payment.kind === 'credit_purchase') {
      await PaymentsService.addPurchasedCredits(payment);
      await SubscriptionActivityService.record({
        clinicId,
        type: 'credits_purchased',
        title: `Bought ${result.planName}`,
        amount: fromPaise(payment.amountPaise),
        currency: payment.currency,
        metadata: {
          paymentId: payment.id,
          transactionId: payment.providerPaymentId,
        },
      });
      await subscriptionNotify(
        'subscription.addon_receipt',
        {
          clinicId,
          transactionId: payment.providerPaymentId ?? '',
          invoiceId: result.invoiceId ?? '',
          storedInvoice: true,
          items: [
            {
              name: result.planName,
              quantity: 1,
              billingCycle: 'one-time',
              amount: Number(fromPaise(payment.amountPaise)),
            },
          ],
          totalAmount: Number(fromPaise(payment.amountPaise)),
        },
        payment.id
      );
      return { ...result, staffReactivated: 0, doctorsReactivated: 0 };
    }
    const { applied, archive } = result.addOnChanges ?? {
      applied: 0,
      archive: [],
    };
    await AddOnChangeService.afterRenewal(
      clinicId,
      applied,
      archive,
      payment.id
    );
    if (
      payment.kind === 'renewal' &&
      payment.periodStart &&
      payment.periodStart <= new Date() &&
      result.subscriptionId
    ) {
      // Imported here: the scheduled-change service imports billing services.
      const { ScheduledChangeService } =
        await import('../core/scheduledChange.service');
      await ScheduledChangeService.applyPaidSwitches(
        new Date(),
        result.subscriptionId
      );
    }
    await LimitationService.invalidateClinicCache(clinicId);
    const reactivation =
      await LimitationService.reactivateStaffOnUpgrade(clinicId);
    if (result.couponFull) {
      logger.warn(
        `[Payments] Coupon ${payment.couponId} was already at its limit when payment ${payment.id} applied`
      );
    }
    await SubscriptionActivityService.record({
      clinicId,
      type:
        payment.kind === 'renewal'
          ? 'renewal_payment'
          : payment.kind === 'plan_change'
            ? 'plan_upgraded'
            : payment.kind === 'addon_purchase'
              ? 'addon_purchased'
              : 'subscription_created',
      title:
        payment.kind === 'renewal'
          ? `Renewed ${result.planName}`
          : payment.kind === 'plan_change'
            ? `Changed plan to ${result.planName}`
            : payment.kind === 'addon_purchase'
              ? `Added ${result.planName.replace(/ × 1(?=,|$)/g, '')}`
              : `Subscribed to ${result.planName}`,
      description: payment.periodEnd
        ? `Active until ${formatISTDate(payment.periodEnd)}.`
        : null,
      amount: fromPaise(payment.amountPaise),
      currency: payment.currency,
      metadata: {
        subscriptionId: result.subscriptionId,
        paymentId: payment.id,
        transactionId: payment.providerPaymentId,
        discount: fromPaise(payment.discountPaise),
      },
    });
    // Queued: the email builds and stores the invoice PDF, which takes seconds.
    if (payment.kind === 'addon_purchase') {
      const lines = payment.lines.items.filter((l) => l.kind === 'addon');
      await subscriptionNotify(
        'subscription.addon_receipt',
        {
          clinicId,
          transactionId: payment.providerPaymentId ?? '',
          invoiceId: result.invoiceId ?? '',
          storedInvoice: true,
          items: lines.map((l) => ({
            name: l.description,
            quantity: l.quantity ?? 1,
            billingCycle: l.billingCycle ?? 'monthly',
            amount: Number(fromPaise(l.amountPaise)),
          })),
          totalAmount: Number(fromPaise(payment.amountPaise)),
        },
        payment.id
      );
      return { ...result, ...reactivation };
    }
    const cycle = payment.lines.items.find(
      (l) => l.kind === 'plan'
    )?.billingCycle;
    await subscriptionNotify(
      'subscription.payment_receipt',
      {
        clinicId,
        subscriptionId: result.subscriptionId,
        planName: result.planName,
        amount: fromPaise(payment.amountPaise),
        transactionId: payment.providerPaymentId ?? '',
        paid: true,
        billingCycle: cycle,
        invoiceId: result.invoiceId ?? undefined,
      },
      payment.id
    );
    return { ...result, ...reactivation };
  }

  /** The checkout hold makes this rare; a coupon already full keeps the discount the clinic paid with. */
  /** Adds the pack's credits once per payment; safe to call again. */
  private static async addPurchasedCredits(payment: SubscriptionPayment) {
    const line = payment.lines.items.find((l) => l.kind === 'credits');
    if (!line?.creditType || !line.credits) {
      logger.error(
        `[Payments] Credit payment ${payment.id} has no credits line`
      );
      return;
    }
    await grantPurchasedCredits({
      clinicId: payment.ownerId,
      creditType: line.creditType as CreditType,
      credits: line.credits,
      paymentId: payment.id,
      reason: `Bought ${line.description}`,
    });
  }

  private static async claimCoupon(tx: Tx, couponId: number, now: Date) {
    const [claimed] = await tx
      .update(CouponModel)
      .set({ currentUses: sql`${CouponModel.currentUses} + 1`, updatedAt: now })
      .where(
        and(
          eq(CouponModel.id, couponId),
          or(
            isNull(CouponModel.maxUses),
            lt(CouponModel.currentUses, CouponModel.maxUses)
          )
        )
      )
      .returning({ id: CouponModel.id });
    return !claimed;
  }

  /** The Razorpay window was closed or the bank declined; a closed window frees the open-checkout slot. */
  static async recordFailure(
    payment: SubscriptionPayment,
    input: { reason: string | null; dropped: boolean }
  ) {
    if (!['created', 'pending'].includes(payment.status)) return;
    // An AutoPay charge is one try: it fails for good, and the renewal job makes the next one.
    const autoPay = payment.kind === 'renewal' && !!payment.mandateId;
    // Conditional on the attempt count: a reported close and a webhook failure for the same try count once.
    const [counted] = await database
      .update(SubscriptionPaymentModel)
      .set({
        attemptCount: payment.attemptCount + 1,
        failureReason: input.reason?.slice(0, 255) ?? null,
        ...(autoPay
          ? { status: 'failed' as const }
          : input.dropped && payment.status === 'created'
            ? { status: 'abandoned' as const }
            : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(SubscriptionPaymentModel.id, payment.id),
          eq(SubscriptionPaymentModel.attemptCount, payment.attemptCount)
        )
      )
      .returning({ id: SubscriptionPaymentModel.id });
    if (!counted) return;

    const retry = autoPay
      ? await PaymentsService.afterAutoPayFailure(payment)
      : null;
    // Name what was being bought: a plan, an add-on, a WhatsApp pack or the AutoPay check.
    const itemName =
      payment.kind === 'mandate_setup'
        ? 'the AutoPay approval'
        : (payment.lines.items.find(
            (l) =>
              l.kind === 'plan' || l.kind === 'addon' || l.kind === 'credits'
          )?.description ?? 'your subscription');
    await SubscriptionActivityService.record({
      clinicId: payment.ownerId,
      type: 'payment_failed',
      title: autoPay
        ? 'AutoPay payment failed'
        : input.dropped
          ? 'Payment not completed'
          : 'Payment failed',
      // Short label for the timeline, e.g. "WhatsApp messages × 250 · window closed".
      description: `${itemName.replace(/^(the|your) /, '').replace(/^./, (c) => c.toUpperCase())}${input.dropped ? ' · window closed' : ''}`,
      amount: fromPaise(payment.amountPaise),
      currency: payment.currency,
      metadata: {
        paymentId: payment.id,
        orderId: payment.providerOrderId,
        reason: input.reason,
      },
    });
    await subscriptionNotify(
      'subscription.payment_failed',
      {
        clinicId: payment.ownerId,
        itemName,
        amount: Number(fromPaise(payment.amountPaise)),
        reason: input.reason,
        droppedCheckout: input.dropped,
        itemType: payment.kind === 'addon_purchase' ? 'addon' : 'subscription',
        ...(retry ? { autoPay: retry } : {}),
      },
      `${payment.id}|${payment.attemptCount + 1}`
    );
  }

  /** Marks the plan past due and says when AutoPay tries again (null = no more tries). */
  private static async afterAutoPayFailure(payment: SubscriptionPayment) {
    if (payment.subscriptionId) {
      await database
        .update(SubscriptionModel)
        .set({ status: 'past_due', updatedAt: new Date() })
        .where(
          and(
            eq(SubscriptionModel.id, payment.subscriptionId),
            eq(SubscriptionModel.status, 'active')
          )
        );
    }
    const { AutoPayRenewalService } = await import('./autoPayRenewal.service');
    const tries = await AutoPayRenewalService.failedTries(
      payment.ownerId,
      payment.periodStart!
    );
    const accessUntil = payment.periodStart!;
    const nextTry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return {
      retryOn:
        tries < AutoPayRenewalService.MAX_TRIES && nextTry < accessUntil
          ? nextTry.toISOString()
          : null,
      accessUntil: accessUntil.toISOString(),
    };
  }

  /**
   * Razorpay confirmed the refund: marks it refunded and issues the credit note, once.
   * A Super Admin refund (done_by set) also takes back what was bought; a duplicate gave nothing.
   */
  static async completeRefund(payment: SubscriptionPayment) {
    const reason = payment.doneBy
      ? (payment.reason ?? 'Refunded')
      : 'Duplicate payment refunded';
    const result = await database.transaction(async (tx) => {
      const [row] = await tx
        .update(SubscriptionPaymentModel)
        .set({ status: 'refunded', needsRefund: false, updatedAt: new Date() })
        .where(
          and(
            eq(SubscriptionPaymentModel.id, payment.id),
            eq(SubscriptionPaymentModel.status, 'captured')
          )
        )
        .returning();
      if (!row) return null;
      return {
        row,
        note: await InvoiceService.issueCreditNote(tx, row, reason),
      };
    });
    if (!result) return;
    if (result.note) await InvoiceService.renderCreditNotePdf(result.note.id);
    // Runs once: the refund is already marked, so a failure here needs a person, not a retry.
    if (payment.ownerType === 'clinic') {
      const item = payment.lines.items.find(
        (l) => l.kind === 'plan' || l.kind === 'addon' || l.kind === 'credits'
      );
      const [inv] = await database
        .select({ number: SubscriptionInvoiceModel.invoiceNumber })
        .from(SubscriptionInvoiceModel)
        .where(eq(SubscriptionInvoiceModel.paymentId, payment.id))
        .limit(1);
      await subscriptionNotify(
        'subscription.refund_issued',
        {
          clinicId: payment.ownerId,
          amount: fromPaise(payment.amountPaise),
          itemName: item?.description ?? 'your subscription',
          invoiceNumber: inv?.number ?? null,
          creditNoteId: result.note?.id ?? null,
          creditNoteNumber: result.note?.creditNoteNumber ?? null,
          endedItem: !payment.doneBy
            ? null
            : item?.kind === 'credits'
              ? 'Unused messages from this pack have been removed.'
              : payment.kind === 'addon_purchase'
                ? 'The add-on bought with this payment has ended.'
                : null,
        },
        payment.id
      );
    }
    if (payment.doneBy) {
      await PaymentsService.takeBack(result.row, reason, payment.doneBy).catch(
        (e) =>
          logger.error(
            `[Payments] Refund ${payment.id} done, but taking back the pack or add-on failed; end it by hand:`,
            e
          )
      );
    }
    if (payment.ownerType === 'clinic' && result.note) {
      await SubscriptionActivityService.record({
        clinicId: payment.ownerId,
        type: 'payment_refunded',
        title: `Credit note ${result.note.creditNoteNumber} issued`,
        description: `Reverses the invoice for ₹${fromPaise(payment.amountPaise)}.`,
        metadata: { paymentId: payment.id, creditNoteId: result.note.id },
      });
    }
  }

  /** A refunded WhatsApp pack loses its unused messages; a refunded add-on purchase ends those units. */
  private static async takeBack(
    payment: SubscriptionPayment,
    reason: string,
    byUserId: string
  ) {
    if (payment.lines.items.some((l) => l.kind === 'credits')) {
      await revokePurchasedCredits(
        payment.id,
        `Refund: ${reason}`.slice(0, 255),
        byUserId
      );
    }
    if (payment.kind !== 'addon_purchase' || payment.ownerType !== 'clinic')
      return;
    for (const l of payment.lines.items) {
      if (l.kind !== 'addon' || !l.addOnId || !l.quantity) continue;
      const [active] = await database
        .select({
          id: SubscriptionAddOnModel.id,
          quantity: SubscriptionAddOnModel.quantity,
        })
        .from(SubscriptionAddOnModel)
        .innerJoin(
          SubscriptionModel,
          eq(SubscriptionModel.id, SubscriptionAddOnModel.subscriptionId)
        )
        .where(
          and(
            eq(SubscriptionModel.ownerType, 'clinic'),
            eq(SubscriptionModel.ownerId, payment.ownerId),
            eq(SubscriptionAddOnModel.addOnId, l.addOnId),
            eq(SubscriptionAddOnModel.status, 'active')
          )
        )
        .limit(1);
      if (!active) continue;
      const left = active.quantity - l.quantity;
      await database
        .update(SubscriptionAddOnModel)
        .set(
          left > 0
            ? { quantity: left, updatedAt: new Date() }
            : { status: 'cancelled', updatedAt: new Date() }
        )
        .where(eq(SubscriptionAddOnModel.id, active.id));
    }
    await LimitationService.invalidateClinicCache(payment.ownerId);
  }

  /** A failed refund keeps needs_refund set, so the daily check retries it. */
  static async refundDuplicate(payment: SubscriptionPayment) {
    if (!payment.providerPaymentId) return;
    try {
      // Already refunded at Razorpay (an earlier try got through): only our side is left to finish.
      const at = (await razorpayClient.fetchPayment(
        payment.providerPaymentId
      )) as { status?: string };
      if (at?.status === 'refunded')
        return PaymentsService.completeRefund(payment);
      const refund = (await razorpayClient.refundPayment(
        payment.providerPaymentId,
        {
          reason: payment.doneBy
            ? (payment.reason ?? 'refund').slice(0, 200)
            : 'duplicate_payment',
          paymentRowId: payment.id,
        }
      )) as { status?: string };
      // Processed now, or later by the refund.processed webhook; needs_refund stays set till then.
      if (refund?.status === 'processed')
        await PaymentsService.completeRefund(payment);
      logger.warn(
        `[Payments] Duplicate payment ${payment.providerPaymentId} for owner ${payment.ownerId} refunded`
      );
    } catch (error) {
      logger.error(
        `[Payments] Refund failed for duplicate payment ${payment.providerPaymentId} (row ${payment.id}); needs_refund stays set:`,
        error
      );
    }
  }
}
