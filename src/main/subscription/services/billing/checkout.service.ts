import { and, desc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { OwnerSubscriptionService } from '../core/ownerSubscription.service';
import { isUniqueViolation } from '../../../../utils/db.utils';
import { envConfig } from '../../../../utils/envConfig';
import logger from '../../../../utils/logger';
import { fromPaise, toPaise } from '../../../money';
import { getPackForSale } from '../../../credits';
import { razorpayClient } from '../../gateway/razorpay.client';
import { PlanVersionModel } from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import {
  SubscriptionPaymentModel,
  type SubscriptionPayment,
} from '../../models/subscriptionPayment.model';
import { sameLines, type Cycle } from '../../utils/checkout.utils';
import type { PaymentLine } from '../../types/subscriptionPayment.types';
import {
  AddOnPricingService,
  creditPacksAllowed,
} from './addOnPricing.service';
import { AutoPayService, type AutoPayMethod } from './autoPay.service';
import { PaymentsService } from './payments.service';
import { PlanPricingService } from './planPricing.service';
import { TaxService } from './tax.service';
import { withTax } from '../../utils/invoiceTax.utils';
import type { TaxSetting } from '../../types/tax.types';

const OPEN = ['created', 'pending'] as const;

type Mandate = {
  id: string;
  customerId: string;
  method: AutoPayMethod;
  maxAmountPaise: number;
  expireAt: Date;
};
const PURCHASES = [
  'plan_purchase',
  'plan_change',
  'renewal',
  'addon_purchase',
] as const;

/** Starts a plan checkout: the payment row is written first, so every Razorpay order has our record. */
export class CheckoutService {
  /** A plan chosen on the billing page: Free needs no payment, a paid plan opens a checkout. */
  static async subscribe(input: {
    clinicId: string;
    planId: string;
    cycle: Cycle;
    couponCode?: string;
    idempotencyKey?: string;
    autoPay?: { method: AutoPayMethod; email?: string };
  }) {
    const [plan] = await database
      .select({
        id: SubscriptionPlanModel.id,
        kind: SubscriptionPlanModel.kind,
      })
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, input.planId))
      .limit(1);
    if (!plan) throw new HttpError(400, 'Invalid plan');

    // Every clinic already has the Free plan; leaving a paid plan for it is a scheduled downgrade.
    if (plan.kind === 'free') {
      const current = await OwnerSubscriptionService.getCurrent(
        'clinic',
        input.clinicId
      );
      if (current?.state.isValid && current.plan.kind === 'paid') {
        throw new HttpError(
          409,
          'To move to the Free plan, schedule a downgrade from the billing page.'
        );
      }
      return { requiresPayment: false as const };
    }

    const { idempotencyKey } = input;
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new HttpError(
        400,
        'The checkout could not start. Please refresh the page and try again.'
      );
    }
    return CheckoutService.startPlanCheckout({ ...input, idempotencyKey });
  }

  static async startPlanCheckout(input: {
    clinicId: string;
    planId: string;
    cycle: Cycle;
    couponCode?: string;
    idempotencyKey: string;
    /** Pay the first month and approve AutoPay in the same checkout (monthly only). */
    autoPay?: { method: AutoPayMethod; email?: string };
  }) {
    const { clinicId, idempotencyKey } = input;
    const replay = await CheckoutService.byKey(clinicId, idempotencyKey);
    if (replay) return CheckoutService.response(replay);
    if (input.autoPay && input.cycle !== 'monthly') {
      throw new HttpError(400, 'AutoPay is for monthly plans only.');
    }
    if (input.autoPay && !envConfig.ENABLE_SUBSCRIPTION_PAYMENTS) {
      throw new HttpError(400, 'AutoPay is not available right now.');
    }

    await OwnerSubscriptionService.assertNoRenewalInFlight(clinicId);
    const quote = await PlanPricingService.quote({
      clinicId,
      planId: input.planId,
      cycle: input.cycle,
      couponCode: input.couponCode,
    });
    // Renewal and upgrade dates are fixed now; a purchase or a switch starts on the day it is paid.
    const knownPeriod =
      quote.case === 'renewal' || quote.case === 'upgrade'
        ? { periodStart: quote.periodStart, periodEnd: quote.periodEnd }
        : {};
    let mandate: Mandate | undefined;
    if (input.autoPay) {
      // Razorpay cannot approve AutoPay on a ₹0 order; the clinic turns it on after a free first month.
      if (quote.amountPaise === 0) {
        throw new HttpError(
          400,
          'AutoPay can be turned on from the billing page after this free month.'
        );
      }
      const prepared = await AutoPayService.prepare({
        clinicId,
        method: input.autoPay.method,
        // The same figure /quote shows as autoPayLimit (monthly only, checked above).
        maxAmountPaise: quote.autoPayLimit!.limitPaise,
        email: input.autoPay.email,
      });
      mandate = {
        id: prepared.mandate.id,
        customerId: prepared.customerId,
        method: input.autoPay.method,
        maxAmountPaise: prepared.mandate.maxAmountPaise,
        expireAt: prepared.mandate.tokenExpiresAt!,
      };
    }
    return CheckoutService.open({
      clinicId,
      idempotencyKey,
      kind: quote.kind,
      subscriptionId: quote.subscriptionId,
      period: knownPeriod,
      items: quote.items,
      amountPaise: quote.amountPaise,
      discountPaise: quote.discountPaise,
      tax: quote.tax,
      couponId: quote.couponId,
      mandate,
    });
  }

  /** Add-ons are priced and charged by the same quote, for the days left in the current period. */
  static async startAddOnCheckout(input: {
    clinicId: string;
    addOns: { addOnId: string; quantity: number }[];
    creditPackId?: string;
    couponCode?: string;
    idempotencyKey: string;
  }) {
    const { clinicId, idempotencyKey } = input;
    const replay = await CheckoutService.byKey(clinicId, idempotencyKey);
    if (replay) return CheckoutService.response(replay);

    const quote = await AddOnPricingService.quote({
      clinicId,
      addOns: input.addOns,
      creditPackId: input.creditPackId,
      couponCode: input.couponCode,
    });
    // A pack on its own is a credit purchase; with add-ons it rides on the add-on order.
    const withAddOns = input.addOns.length > 0;
    return CheckoutService.open({
      clinicId,
      idempotencyKey,
      kind: withAddOns ? 'addon_purchase' : 'credit_purchase',
      subscriptionId: withAddOns ? quote.subscriptionId : null,
      period:
        withAddOns && quote.periodEnd
          ? { periodStart: quote.periodStart, periodEnd: quote.periodEnd }
          : {},
      items: quote.items,
      amountPaise: quote.amountPaise,
      discountPaise: quote.discountPaise,
      tax: quote.tax,
      couponId: quote.couponId,
    });
  }

  /** A WhatsApp (or other) credit pack: one-time, any plan, priced as the pack says (GST included). */
  static async startCreditCheckout(input: {
    clinicId: string;
    packId: string;
    idempotencyKey: string;
  }) {
    const { clinicId, idempotencyKey } = input;
    const replay = await CheckoutService.byKey(clinicId, idempotencyKey);
    if (replay) return CheckoutService.response(replay);
    if (!(await creditPacksAllowed(clinicId))) {
      throw new HttpError(
        403,
        'WhatsApp packs are not available on your plan.'
      );
    }
    const pack = await getPackForSale(input.packId);
    const tax = await TaxService.inForce();
    const split =
      tax.mode === 'exclusive' ? await TaxService.splitFor(clinicId) : null;
    const pricePaise = toPaise(pack.priceInr);
    const taxed = withTax(pricePaise, tax, split);
    const amountPaise = taxed.totalPaise;
    return CheckoutService.open({
      clinicId,
      idempotencyKey,
      kind: 'credit_purchase',
      subscriptionId: null,
      period: {},
      items: [
        {
          kind: 'credits',
          description: `${pack.creditType === 'whatsapp' ? 'WhatsApp messages' : 'Credits'} × ${pack.credits.toLocaleString('en-IN')}`,
          amountPaise: pricePaise,
          packId: pack.id,
          creditType: pack.creditType,
          credits: pack.credits,
          quantity: 1,
        },
        ...(taxed.line ? [taxed.line] : []),
      ],
      amountPaise,
      discountPaise: 0,
      couponId: null,
      tax,
    });
  }

  /** Writes the payment row, then the Razorpay order; a ₹0 total is applied at once. */
  private static async open(input: {
    clinicId: string;
    idempotencyKey: string;
    kind: SubscriptionPayment['kind'];
    subscriptionId: string | null;
    period: { periodStart?: Date; periodEnd?: Date };
    items: PaymentLine[];
    amountPaise: number;
    discountPaise: number;
    couponId: number | null;
    mandate?: Mandate;
    /** GST frozen on the payment; its invoice reads it from here. */
    tax: TaxSetting;
  }) {
    const {
      clinicId,
      idempotencyKey,
      items,
      amountPaise,
      discountPaise,
      couponId,
    } = input;
    let row: SubscriptionPayment;
    try {
      const outcome = await database.transaction(async (tx) => {
        const [open] = await tx
          .select()
          .from(SubscriptionPaymentModel)
          .where(
            and(
              eq(SubscriptionPaymentModel.ownerType, 'clinic'),
              eq(SubscriptionPaymentModel.ownerId, clinicId),
              inArray(SubscriptionPaymentModel.status, [...OPEN]),
              inArray(SubscriptionPaymentModel.kind, [...PURCHASES])
            )
          )
          .for('update');
        if (open) {
          if (open.status === 'pending') {
            throw new HttpError(
              409,
              'A payment is still being confirmed by the bank. Please wait a minute and try again.'
            );
          }
          if (sameLines(open.lines.items, items)) {
            if (open.providerOrderId) return { row: open, reused: true };
            throw new HttpError(
              409,
              'This checkout is still starting. Please try again in a moment.'
            );
          }
          await tx
            .update(SubscriptionPaymentModel)
            .set({ status: 'abandoned', updatedAt: new Date() })
            .where(eq(SubscriptionPaymentModel.id, open.id));
        }
        const [created] = await tx
          .insert(SubscriptionPaymentModel)
          .values({
            ownerType: 'clinic',
            ownerId: clinicId,
            kind: input.kind,
            subscriptionId: input.subscriptionId,
            ...input.period,
            status: 'created',
            amountPaise,
            discountPaise,
            taxRateBp: input.tax.rateBp,
            taxMode: input.tax.mode,
            couponId,
            lines: { version: 1, items },
            provider:
              amountPaise > 0 && envConfig.ENABLE_SUBSCRIPTION_PAYMENTS
                ? 'razorpay'
                : null,
            mandateId: input.mandate?.id ?? null,
            idempotencyKey,
          })
          .returning();
        return { row: created!, reused: false };
      });
      if (outcome.reused) return CheckoutService.response(outcome.row);
      row = outcome.row;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Another request with this key, or another checkout, won the race: answer with its order.
      const winner = await CheckoutService.byKey(clinicId, idempotencyKey);
      if (winner) return CheckoutService.response(winner);
      throw new HttpError(
        409,
        'Another checkout started at the same time. Please try again.'
      );
    }

    // Razorpay rejects a ₹0 order, so a fully discounted plan is activated here without one.
    if (amountPaise === 0) {
      await PaymentsService.activatePayment({
        paymentRowId: row.id,
        providerPaymentId: null,
      });
      return { requiresPayment: false, paymentId: row.id };
    }

    // Payments off: no Razorpay order; the plan, add-on or pack is applied now, as in the ₹0 case.
    if (!envConfig.ENABLE_SUBSCRIPTION_PAYMENTS) {
      const applied = await PaymentsService.activatePayment({
        paymentRowId: row.id,
        providerPaymentId: null,
      });
      if (applied.kind === 'duplicate') {
        throw new HttpError(
          409,
          'Your plan changed while this was being applied. Please refresh and try again.'
        );
      }
      return { requiresPayment: false, paymentId: row.id };
    }

    try {
      const notes = { paymentId: row.id, clinicId, kind: row.kind };
      const order = input.mandate
        ? await razorpayClient.createMandateOrder({
            amountPaise,
            customerId: input.mandate.customerId,
            method: input.mandate.method,
            maxAmountPaise: input.mandate.maxAmountPaise,
            expireAt: input.mandate.expireAt,
            receipt: row.id,
            notes,
          })
        : await razorpayClient.createOrder({
            amountPaise,
            receipt: row.id,
            notes,
          });
      const [withOrder] = await database
        .update(SubscriptionPaymentModel)
        .set({ providerOrderId: order.id, updatedAt: new Date() })
        .where(eq(SubscriptionPaymentModel.id, row.id))
        .returning();
      return CheckoutService.response(withOrder);
    } catch (e) {
      // Frees the one-open-checkout slot, so the clinic can simply try again.
      await database
        .update(SubscriptionPaymentModel)
        .set({
          status: 'failed',
          failureReason: String((e as Error).message ?? e).slice(0, 255),
          updatedAt: new Date(),
        })
        .where(eq(SubscriptionPaymentModel.id, row.id));
      logger.error(
        `[Checkout] Razorpay order failed for payment ${row.id}:`,
        e
      );
      throw e;
    }
  }

  /** The open checkout again, or a fresh one for the last failed or abandoned plan payment. */
  static async retryLast(clinicId: string) {
    const [last] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          inArray(SubscriptionPaymentModel.kind, [
            'plan_purchase',
            'plan_change',
            'renewal',
          ]),
          inArray(SubscriptionPaymentModel.status, [
            'created',
            'abandoned',
            'failed',
          ])
        )
      )
      .orderBy(desc(SubscriptionPaymentModel.createdAt))
      .limit(1);
    if (!last) {
      throw new HttpError(404, 'There is no unfinished payment to retry.');
    }
    if (last.status === 'created' && last.providerOrderId) {
      return CheckoutService.response(last);
    }

    const plan = last.lines.items.find((l) => l.kind === 'plan');
    const coupon = last.lines.items.find((l) => l.kind === 'coupon');
    const [version] = plan?.planVersionId
      ? await database
          .select({ planId: PlanVersionModel.planId })
          .from(PlanVersionModel)
          .where(eq(PlanVersionModel.id, plan.planVersionId))
          .limit(1)
      : [];
    if (!version || !plan?.billingCycle) {
      throw new HttpError(404, 'There is no unfinished payment to retry.');
    }
    // Keyed on the payment being retried, so a double click on Retry still makes one order.
    return CheckoutService.startPlanCheckout({
      clinicId,
      planId: version.planId,
      cycle: plan.billingCycle,
      couponCode: coupon?.couponCode,
      idempotencyKey: `retry:${last.id}`,
    });
  }

  private static async byKey(clinicId: string, idempotencyKey: string) {
    const [row] = await database
      .select()
      .from(SubscriptionPaymentModel)
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          eq(SubscriptionPaymentModel.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** The /subscribe response the checkout screen reads; amount is paise, the rest rupees. */
  private static async response(row: SubscriptionPayment) {
    if ((row.amountPaise === 0 || !row.provider) && row.status === 'captured') {
      return { requiresPayment: false, paymentId: row.id };
    }
    if (!row.providerOrderId || !['created', 'pending'].includes(row.status)) {
      throw new HttpError(
        409,
        'This checkout is no longer open. Please start the payment again.'
      );
    }
    const plan = row.lines.items.find((l) => l.kind === 'plan');
    const coupon = row.lines.items.find((l) => l.kind === 'coupon');
    const [version] = plan?.planVersionId
      ? await database
          .select({ planId: PlanVersionModel.planId })
          .from(PlanVersionModel)
          .where(eq(PlanVersionModel.id, plan.planVersionId))
          .limit(1)
      : [];
    const subtotalPaise = row.amountPaise + row.discountPaise;

    return {
      requiresPayment: true,
      paymentId: row.id,
      orderId: row.providerOrderId,
      amount: row.amountPaise,
      currency: row.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      // Present when this checkout also approves AutoPay.
      ...(row.mandateId
        ? await AutoPayService.checkoutFields(row.mandateId)
        : {}),
      planId: version?.planId ?? null,
      addOns: row.lines.items
        .filter((l) => l.kind === 'addon')
        .map((l) => ({
          id: l.addOnId,
          name: l.description,
          quantity: l.quantity,
          billingCycle: l.billingCycle,
          proRatedPrice: Number(fromPaise(l.amountPaise)),
        })),
      discount: coupon
        ? {
            couponCode: coupon.couponCode ?? '',
            couponId: row.couponId,
            discountAmount: Number(fromPaise(row.discountPaise)),
            originalAmount: Number(fromPaise(subtotalPaise)),
            finalAmount: Number(fromPaise(row.amountPaise)),
          }
        : undefined,
      quote: {
        planName: plan?.description ?? '',
        billingCycle: plan?.billingCycle ?? 'monthly',
        subtotal: Number(fromPaise(subtotalPaise)),
        couponDiscount: Number(fromPaise(row.discountPaise)),
        totalPayable: Number(fromPaise(row.amountPaise)),
      },
    };
  }
}
