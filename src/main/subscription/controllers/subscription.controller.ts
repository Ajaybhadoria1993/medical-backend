import { Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { envConfig } from '../../../utils/envConfig';
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  razorpayInstance,
  verifyWebhookSignature,
} from '../../../utils/razorpay';
import {
  assertOrderCoversAmount,
  decodeAddOnItems,
  resolveVerifiedOrder,
} from '../utils/razorpayOrder.utils';
import {
  billingCycleFromProviderId,
  planPriceForCycle,
  providerIdForCycle,
  PROVIDER_SUBSCRIPTION_ID,
} from '../utils/billingCycle.utils';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import { ClinicPaymentAccountModel } from '../../clinic/models/clinicPaymentAccount.model';
import { database } from '../../../configurations/dbConnection';
import { and, desc, eq, or } from 'drizzle-orm';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { couponService } from '../services/coupon.service';
import { PricingService } from '../services/pricing.service';
import { SubscriptionActivityService } from '../services/subscriptionActivity.service';
import { isSubscriptionValid } from '../../../utils/subscriptionExpiry';

// create subscription plan
export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const { slug, name, description, price, currency, features } =
    req.validatedBody;

  // Ensure features is always an array
  const featuresArray = Array.isArray(features) ? features : [];

  const plan = await SubscriptionService.createPlan({
    slug,
    name,
    description,
    price,
    currency,
    features: featuresArray,
  });

  if (!plan) {
    throw new HttpError(400, 'Plan not created');
  }

  return sendCreated(res, 'Plan created successfully', plan);
});

// manage features (add/update/delete)
export const manageFeatures = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const payload = req.validatedBody;

    const features = await SubscriptionService.manageFeatures(planId, payload);

    return sendOk(res, 'Features managed successfully', features);
  }
);

// update a subscription plan (Super Admin)
export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const payload = req.validatedBody;

  const plan = await SubscriptionService.updatePlan(id, payload);

  return sendOk(res, 'Plan updated successfully', plan);
});

// delete a subscription plan (Super Admin)
export const deletePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validatedParams;

  const plan = await SubscriptionService.deletePlan(id);

  return sendOk(res, 'Plan deleted successfully', plan);
});

// get all subscription plans
export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await SubscriptionService.getPlans();
  if (!plans) {
    throw new HttpError(400, 'Plans not found');
  }
  return sendOk(res, 'Plans fetched successfully', plans);
});

export const subscribeClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId, providerSubscriptionId, couponCode, discountAmount } =
      req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new HttpError(400, 'Invalid plan');
    }

    // Free plan - create subscription directly
    if (plan.slug === 'solo' || plan.slug === 'Free') {
      const sub = await SubscriptionService.subscribeClinic({
        clinicId,
        planId,
        provider: 'manual',
        providerSubscriptionId: 'free_plan',
        paymentMode: 'free',
        paymentStatus: 'success',
        discountAmount,
      });

      return sendCreated(res, 'Free subscription activated', sub);
    }

    // Priced through the same service as POST /subscription/quote, so the
    // amount charged here is by construction the amount the clinic was shown —
    // including the credit for unused days of the subscription being replaced.
    const quote = await PricingService.quotePlanPurchase({
      clinicId,
      planId,
      billingCycle: billingCycleFromProviderId(providerSubscriptionId),
      couponCode,
      commitCoupon: true,
    });

    const price = quote.totalPayable;

    const discountInfo =
      quote.couponId && quote.couponCode
        ? {
            couponId: quote.couponId,
            couponCode: quote.couponCode,
            discountAmount: quote.couponDiscount,
            originalAmount: quote.subtotal,
          }
        : null;

    // Nothing left to pay — a 100%-off coupon, or a proration credit that
    // covers the new plan outright. Activate directly.
    if (price <= 0) {
      const sub = await SubscriptionService.subscribeClinic({
        clinicId,
        planId,
        provider: discountInfo ? 'coupon' : 'credit',
        // Keep the real cycle id: overwriting it with the coupon code used to
        // give a fully-discounted yearly plan a 30-day period.
        providerSubscriptionId,
        paymentMode: discountInfo ? 'coupon' : 'credit',
        paymentStatus: 'success',
        price: '0',
        discountAmount,
      });

      // The quote charged for carrying the add-ons onto this period, so their
      // rows have to follow the plan's new dates and cycle.
      await PricingService.realignAddOnsToPeriod({
        clinicId,
        expiresAt: sub?.expiresAt ? new Date(sub.expiresAt) : null,
        billingCycle: billingCycleFromProviderId(providerSubscriptionId),
      });

      // Record coupon usage
      if (discountInfo) {
        await couponService.recordUsage({
          couponId: discountInfo.couponId,
          clinicId,
          planId,
          orderValue: discountInfo.originalAmount,
          discountAmount: discountInfo.discountAmount,
          finalAmount: 0,
          billingCycle: billingCycleFromProviderId(providerSubscriptionId),
        });
      }

      return sendCreated(res, 'Subscription activated with coupon', sub);
    }

    // Coupon details go into the order notes so /verify-subscription can record
    // the usage from the order instead of trusting the client's payload.
    const order = await createRazorpayOrder(
      price,
      clinicId,
      planId,
      providerSubscriptionId,
      {
        ...(quote.prorationCredit > 0
          ? { prorationCredit: String(quote.prorationCredit) }
          : {}),
        ...(discountInfo
          ? {
              couponId: String(discountInfo.couponId),
              couponCode: discountInfo.couponCode,
              originalAmount: String(discountInfo.originalAmount),
              discountAmount: String(discountInfo.discountAmount),
            }
          : {}),
      }
    );

    return sendOk(res, 'Payment order created', {
      requiresPayment: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      planId,
      discount: discountInfo
        ? {
            couponCode: discountInfo.couponCode,
            couponId: discountInfo.couponId,
            discountAmount: discountInfo.discountAmount,
            originalAmount: discountInfo.originalAmount,
            finalAmount: price,
          }
        : undefined,
      // The full breakdown behind `amount`, so the client can show what was
      // credited without recomputing any of it.
      quote,
    });
  }
);

// New endpoint to verify payment and complete subscription
export const verifyAndSubscribe = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const targetId =
      req.validatedBody.orderId || req.validatedBody.subscriptionId;
    const { paymentId, signature } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    if (!targetId) {
      throw new HttpError(400, 'orderId or subscriptionId required');
    }

    const existingSubscription = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(eq(ClinicSubscriptionModel.transactionId, paymentId))
      .limit(1);

    if (existingSubscription.length > 0) {
      return sendOk(
        res,
        'Subscription already activated',
        existingSubscription[0]
      );
    }

    // What was purchased comes from the order/subscription itself, never from the request
    // body — the signature alone does not bind the plan or billing cycle.
    const verifiedOrder = await resolveVerifiedOrder({
      orderId: targetId,
      paymentId,
      signature,
      clinicId,
    });

    if (verifiedOrder.isSubscription) {
      const { AutoRenewService } =
        await import('../services/autoRenew.service');
      await AutoRenewService.activateInitialAutoPaySubscription(
        verifiedOrder.orderId,
        paymentId
      );

      const [sub] = await database
        .select()
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        )
        .limit(1);

      if (!sub) {
        throw new HttpError(
          500,
          'Subscription activation failed: active subscription record not found after activation'
        );
      }

      const { LimitationService } =
        await import('../services/limitation.service');
      const reactivation =
        await LimitationService.reactivateStaffOnUpgrade(clinicId);

      return sendCreated(
        res,
        'Payment verified and AutoPay subscription activated',
        {
          subscription: sub,
          staffReactivated: reactivation.staffReactivated,
          doctorsReactivated: reactivation.doctorsReactivated,
        }
      );
    }

    const planId = verifiedOrder.planId;
    const providerSubscriptionId = verifiedOrder.providerSubscriptionId;

    if (!planId) {
      throw new HttpError(400, 'Payment order is not a subscription purchase');
    }

    const [orderPlan] = await database
      .select({
        id: SubscriptionPlanModel.id,
        price: SubscriptionPlanModel.price,
      })
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!orderPlan) {
      throw new HttpError(400, 'Invalid plan on payment order');
    }

    const discountAmount = verifiedOrder.coupon?.discountAmount;

    // The credit for unused days is a legitimate reduction in what was owed, so
    // it has to come off the expected amount — otherwise every prorated upgrade
    // would be rejected here as an underpayment.
    assertOrderCoversAmount(
      verifiedOrder,
      planPriceForCycle(
        orderPlan.price,
        billingCycleFromProviderId(providerSubscriptionId)
      ) -
        verifiedOrder.prorationCredit -
        (discountAmount ?? 0)
    );

    await database
      .update(ClinicSubscriptionModel)
      .set({
        active: false,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.clinicId, clinicId));

    // NOTE: Redis cache is invalidated AFTER new subscription is created
    // (inside SubscriptionService.subscribeClinic) to avoid a race condition
    // where the middleware caches { noSubscription: true } between deactivation and creation.

    let actualPaymentMethod = 'online';
    try {
      const paymentDetails = await razorpayInstance.payments.fetch(paymentId);
      actualPaymentMethod = paymentDetails.method || 'online';
    } catch {
      actualPaymentMethod = 'online';
    }

    // Create subscription with payment success
    const sub = await SubscriptionService.subscribeClinic({
      clinicId,
      planId,
      provider: 'razorpay',
      providerSubscriptionId: providerSubscriptionId,
      paymentMode: actualPaymentMethod,
      transactionId: paymentId,
      paymentStatus: 'success',
      // Record what was actually captured, not the list price — the next
      // proration credit is derived from this figure.
      price: verifiedOrder.amount,
      discountAmount,
    });

    // Add-ons were priced into this order, so carry them onto the new period —
    // without this a switch to yearly leaves them expiring on the old date.
    await PricingService.realignAddOnsToPeriod({
      clinicId,
      expiresAt: sub?.expiresAt ? new Date(sub.expiresAt) : null,
      billingCycle: billingCycleFromProviderId(providerSubscriptionId),
    });

    // Record coupon usage if a coupon was applied when the order was created
    const orderCoupon = verifiedOrder.coupon;
    if (orderCoupon) {
      await couponService.recordUsage({
        couponId: orderCoupon.couponId,
        clinicId,
        planId,
        orderValue: orderCoupon.originalAmount,
        discountAmount: orderCoupon.discountAmount,
        finalAmount: orderCoupon.originalAmount - orderCoupon.discountAmount,
        razorpayOrderId: targetId,
        razorpayPaymentId: paymentId,
        billingCycle: billingCycleFromProviderId(providerSubscriptionId),
      });
    }

    // Reactivate previously deactivated staff (if any were blocked due to expired plan)
    const { LimitationService } =
      await import('../services/limitation.service');
    const reactivation =
      await LimitationService.reactivateStaffOnUpgrade(clinicId);

    return sendCreated(res, 'Payment verified and subscription activated', {
      subscription: sub,
      staffReactivated: reactivation.staffReactivated,
      doctorsReactivated: reactivation.doctorsReactivated,
    });
  }
);

/**
 * Report a client-side payment failure or cancellation (e.g. user cancelled Razorpay modal).
 * Deduplicates by orderId so duplicate entries are not created if webhook also fires.
 */
export const reportPaymentFailed = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { orderId, paymentId, reason, errorCode } = req.validatedBody;

    if (orderId) {
      const alreadyRecorded =
        await SubscriptionActivityService.hasPaymentFailureForOrder(
          clinicId,
          orderId
        );
      if (alreadyRecorded) {
        return sendOk(res, 'Payment failure already recorded', {
          recorded: false,
        });
      }
    }

    let amount: number | null = null;
    const currency = 'INR';
    let planId: string | null = null;
    let providerSubscriptionId: string | null = null;
    let orderNotes: {
      planId?: string;
      providerSubscriptionId?: string;
      addOnItems?: string;
    } = {};

    if (orderId) {
      try {
        const order = await fetchRazorpayOrder(orderId);
        if (order) {
          const notes =
            (order.notes as {
              clinicId?: string;
              planId?: string;
              providerSubscriptionId?: string;
              addOnItems?: string;
            }) || {};

          if (notes.clinicId && notes.clinicId !== clinicId) {
            throw new HttpError(
              403,
              'This payment order belongs to another clinic'
            );
          }

          orderNotes = notes;
          if (order.amount) {
            amount = Number(order.amount) / 100;
          }
          if (notes.planId) {
            planId = String(notes.planId);
          }
          if (notes.providerSubscriptionId) {
            providerSubscriptionId = String(notes.providerSubscriptionId);
          }
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        logger.warn(
          `reportPaymentFailed: could not fetch order details for ${orderId}:`,
          err
        );
      }
    }

    const { title, itemName } =
      await SubscriptionActivityService.resolvePaymentFailureDetails(
        orderNotes
      );

    const description = itemName
      ? `Payment attempt ${amount ? `of ₹${amount} ` : ''}for ${itemName} failed.`
      : `Payment attempt ${amount ? `of ₹${amount} ` : ''}failed.`;

    await SubscriptionActivityService.record({
      clinicId,
      type: 'payment_failed',
      title,
      description,
      amount: amount,
      currency: currency,
      actorUserId: req.user?.id || null,
      metadata: {
        orderId: orderId ?? null,
        paymentId: paymentId ?? null,
        errorCode: errorCode ?? null,
        reason: reason ?? null,
        planId,
        providerSubscriptionId,
        itemName,
        source: 'client_report',
      },
    });

    return sendOk(res, 'Payment failure recorded successfully', {
      recorded: true,
    });
  }
);

export const razorpayWebhookController = async (
  req: Request,
  res: Response
) => {
  const signature = req.headers['x-razorpay-signature'] as string;

  // Verify against the EXACT raw bytes Razorpay signed. Falls back to a
  // re-stringified body only if the raw buffer wasn't captured (should not
  // happen in production, but keeps local testing resilient).
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const bodyToVerify = rawBody
    ? rawBody.toString('utf8')
    : JSON.stringify(req.body);

  if (
    !signature ||
    !verifyWebhookSignature(
      bodyToVerify,
      signature,
      envConfig.RAZORPAY_WEBHOOK_SECRET
    )
  ) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const { event, payload } = req.body;

  try {
    if (event === 'payment.captured') {
      const payment = payload.payment.entity;

      // Check if subscription already exists (idempotency)
      const existingSubscription = await database
        .select()
        .from(ClinicSubscriptionModel)
        .where(eq(ClinicSubscriptionModel.transactionId, payment.id))
        .limit(1);

      if (existingSubscription.length > 0) {
        return res.json({ received: true });
      }

      const orderId = payment.order_id;
      const order = await fetchRazorpayOrder(orderId);

      const notes =
        (order.notes as {
          clinicId?: string;
          planId?: string;
          providerSubscriptionId?: string;
        }) || {};
      const clinicId = notes.clinicId;
      const planId = notes.planId;
      const providerSubscriptionId = notes.providerSubscriptionId;

      // Add-on purchases share the same event but must NOT touch the base
      // subscription. Complete them via the add-on service (webhook backup for
      // when the frontend verify call never arrives). Idempotent by paymentId.
      if (providerSubscriptionId === 'addon-purchase') {
        const addOnItemsRaw = (order.notes as { addOnItems?: string })
          ?.addOnItems;
        if (clinicId && addOnItemsRaw) {
          const addOnItems = decodeAddOnItems(addOnItemsRaw);

          if (addOnItems.length > 0) {
            const { AddOnService } = await import('../services/addon.service');
            await AddOnService.completePurchase(
              clinicId,
              addOnItems,
              payment.id,
              orderId
            );
          }
        }
        return res.json({ received: true });
      }

      if (!clinicId || !planId) {
        return res.json({ received: true });
      }

      // Guard: only proceed if the planId refers to a real subscription plan.
      const [validPlan] = await database
        .select({ id: SubscriptionPlanModel.id })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, planId))
        .limit(1);

      if (!validPlan) {
        return res.json({ received: true });
      }

      await database
        .update(ClinicSubscriptionModel)
        .set({
          active: false,
          updatedAt: new Date(),
        })
        .where(eq(ClinicSubscriptionModel.clinicId, clinicId));

      await SubscriptionService.subscribeClinic({
        clinicId,
        planId,
        provider: 'razorpay',
        providerSubscriptionId: providerSubscriptionId,
        paymentMode: payment.method || 'online',
        transactionId: payment.id,
        paymentStatus: 'success',
      });
    } else if (event === 'payment.failed') {
      // Handle payment failure — log but don't deactivate
      const payment = payload.payment?.entity;
      if (payment?.order_id) {
        const order = await fetchRazorpayOrder(payment.order_id);
        const notes =
          (order.notes as {
            clinicId?: string;
            planId?: string;
            providerSubscriptionId?: string;
            addOnItems?: string;
          }) || {};
        if (notes.clinicId) {
          // Update payment status to failed for tracking
          await database
            .update(ClinicSubscriptionModel)
            .set({
              paymentStatus: 'failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(ClinicSubscriptionModel.clinicId, notes.clinicId),
                eq(ClinicSubscriptionModel.active, true)
              )
            );

          // Invalidate cache so UI reflects failed state
          await redisClient.del(`clinic_active_subscription:${notes.clinicId}`);
          await redisClient.del(`clinic_plan:${notes.clinicId}`);

          // Deduplication: skip if client endpoint or prior webhook already recorded failure for this orderId
          const alreadyRecorded =
            await SubscriptionActivityService.hasPaymentFailureForOrder(
              notes.clinicId,
              payment.order_id
            );

          if (!alreadyRecorded) {
            const paidAmount = payment.amount
              ? Number(payment.amount) / 100
              : null;

            const { title, itemName } =
              await SubscriptionActivityService.resolvePaymentFailureDetails(
                notes
              );

            const description = itemName
              ? `Payment attempt of ₹${paidAmount ?? 0} for ${itemName} failed.`
              : `Payment attempt of ₹${paidAmount ?? 0} failed.`;

            await SubscriptionActivityService.record({
              clinicId: notes.clinicId,
              type: 'payment_failed',
              title,
              description,
              amount: paidAmount,
              currency: payment.currency || 'INR',
              actorUserId: null,
              metadata: {
                orderId: payment.order_id,
                paymentId: payment.id,
                errorCode: payment.error_code ?? null,
                errorReason: payment.error_reason ?? null,
                errorDescription: payment.error_description ?? null,
                planId: notes.planId ?? null,
                providerSubscriptionId: notes.providerSubscriptionId ?? null,
                itemName,
                source: 'webhook',
              },
            });
          }
        }
      }
    } else if (event === 'account.activated') {
      const account = payload.account.entity;
      const accountId = account.id;
      await database
        .update(ClinicPaymentAccountModel)
        .set({
          routeStatus: 'ACTIVE',
          routeOnboardedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
            eq(ClinicPaymentAccountModel.gatewayAccountId, accountId)
          )
        );
    } else if (event === 'product.route.activated') {
      const merchantProduct = payload.merchant_product.entity;
      const accountId = merchantProduct.merchant_id;
      const productId = merchantProduct.id;

      await database
        .update(ClinicPaymentAccountModel)
        .set({
          routeStatus: 'ACTIVE',
          routeOnboardedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
            eq(ClinicPaymentAccountModel.gatewayAccountId, accountId)
          )
        );

      try {
        const { ClinicService } =
          await import('../../clinic/services/clinic.service');
        await ClinicService.syncClinicBankHistory(accountId, productId);
      } catch (err) {
        logger.error(
          `Failed to snapshot bank account history for account ${accountId}:`,
          err
        );
      }
    } else if (event === 'account.suspended') {
      const account = payload.account.entity;
      const accountId = account.id;
      await database
        .update(ClinicPaymentAccountModel)
        .set({
          routeStatus: 'SUSPENDED',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay'),
            eq(ClinicPaymentAccountModel.gatewayAccountId, accountId)
          )
        );
    } else if (event === 'subscription.charged') {
      // Auto-renewal: Razorpay successfully charged the recurring subscription
      const subscription = payload.subscription?.entity;
      const payment = payload.payment?.entity;
      if (subscription?.id && payment?.id) {
        const { AutoRenewService } =
          await import('../services/autoRenew.service');
        await AutoRenewService.handleSubscriptionCharged(
          subscription.id,
          payment.id
        );
      }
    } else if (event === 'subscription.authenticated') {
      // Mandate authorized by the customer — NOW AutoPay is truly enabled.
      const subscription = payload.subscription?.entity;
      if (subscription?.id) {
        logger.info(
          `Webhook subscription.authenticated received for razorpay sub: ${subscription.id}`
        );
        const [matchingSub] = await database
          .select({
            id: ClinicSubscriptionModel.id,
            clinicId: ClinicSubscriptionModel.clinicId,
            providerSubscriptionId:
              ClinicSubscriptionModel.providerSubscriptionId,
          })
          .from(ClinicSubscriptionModel)
          .where(
            and(
              eq(
                ClinicSubscriptionModel.razorpaySubscriptionId,
                subscription.id
              ),
              eq(ClinicSubscriptionModel.active, true)
            )
          )
          .limit(1);

        const notes = subscription.notes ?? {};
        const targetProviderSubId = providerIdForCycle(notes.billingCycle);

        if (
          !matchingSub ||
          (notes.billingCycle &&
            matchingSub.providerSubscriptionId !== targetProviderSubId)
        ) {
          logger.info(
            `subscription.authenticated: no matching row or cycle mismatch for razorpaySubscriptionId=${subscription.id}, attempting initial activation`
          );
          const { AutoRenewService } =
            await import('../services/autoRenew.service');
          try {
            await AutoRenewService.activateInitialAutoPaySubscription(
              subscription.id,
              payload.payment?.entity?.id
            );
          } catch (err) {
            logger.error(
              `subscription.authenticated: activation failed for razorpaySubscriptionId=${subscription.id}:`,
              err
            );
          }
        } else {
          await database
            .update(ClinicSubscriptionModel)
            .set({
              autoRenew: true,
              updatedAt: new Date(),
            })
            .where(eq(ClinicSubscriptionModel.id, matchingSub.id));

          const clinicId = matchingSub.clinicId;
          if (clinicId) {
            await redisClient.del(`clinic_active_subscription:${clinicId}`);
            await redisClient.del(`clinic_plan:${clinicId}`);
            logger.info(
              `AutoPay enabled for clinic ${clinicId} via subscription.authenticated webhook.`
            );

            await SubscriptionActivityService.record({
              clinicId,
              type: 'autopay_authorized',
              title: 'AutoPay active',
              description:
                'Your payment mandate was authorized. Future renewals will be charged automatically.',
              actorUserId: null,
              metadata: { razorpaySubscriptionId: subscription.id },
            });

            try {
              const { AutoRenewService } =
                await import('../services/autoRenew.service');
              await AutoRenewService.syncAutoRenewAmount(clinicId);
            } catch (err) {
              logger.error(
                `Failed to sync AutoPay amount for clinic ${clinicId} after mandate authorization:`,
                err
              );
            }
          }
        }
      }
    } else if (event === 'subscription.pending') {
      // Payment is pending — subscription charge initiated but not yet completed
      const subscription = payload.subscription?.entity;
      if (subscription?.id) {
        const [sub] = await database
          .select({ clinicId: ClinicSubscriptionModel.clinicId })
          .from(ClinicSubscriptionModel)
          .where(
            eq(ClinicSubscriptionModel.razorpaySubscriptionId, subscription.id)
          )
          .limit(1);

        if (sub) {
          await redisClient.del(`clinic_active_subscription:${sub.clinicId}`);
        }
      }
    } else if (event === 'subscription.halted') {
      // Subscription halted due to repeated payment failures
      const subscription = payload.subscription?.entity;
      if (subscription?.id) {
        await database
          .update(ClinicSubscriptionModel)
          .set({
            autoRenew: false,
            razorpaySubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(
            eq(ClinicSubscriptionModel.razorpaySubscriptionId, subscription.id)
          );

        const [sub] = await database
          .select({ clinicId: ClinicSubscriptionModel.clinicId })
          .from(ClinicSubscriptionModel)
          .where(
            eq(ClinicSubscriptionModel.razorpaySubscriptionId, subscription.id)
          )
          .limit(1);

        if (sub) {
          await redisClient.del(`clinic_active_subscription:${sub.clinicId}`);
          await redisClient.del(`clinic_plan:${sub.clinicId}`);
        }
      }
    } else if (event === 'subscription.cancelled') {
      // Subscription cancelled from Razorpay side
      const subscription = payload.subscription?.entity;
      if (subscription?.id) {
        await database
          .update(ClinicSubscriptionModel)
          .set({
            autoRenew: false,
            razorpaySubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(
            eq(ClinicSubscriptionModel.razorpaySubscriptionId, subscription.id)
          );

        const [sub] = await database
          .select({ clinicId: ClinicSubscriptionModel.clinicId })
          .from(ClinicSubscriptionModel)
          .where(
            eq(ClinicSubscriptionModel.razorpaySubscriptionId, subscription.id)
          )
          .limit(1);

        if (sub) {
          await redisClient.del(`clinic_active_subscription:${sub.clinicId}`);
          await redisClient.del(`clinic_plan:${sub.clinicId}`);
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    logger.error('Razorpay webhook handler error:', {
      event: req.body?.event,
      error: error?.message || error,
    });
    res.json({ received: true });
  }
};

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export const initialSubscribeClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new HttpError(400, 'Invalid plan selected');
    }

    // This endpoint grants an unpaid starter subscription, so it may only ever
    // run once per clinic — otherwise it can be replayed to renew a paid plan
    // for free.
    const [existing] = await database
      .select({ id: ClinicSubscriptionModel.id })
      .from(ClinicSubscriptionModel)
      .where(eq(ClinicSubscriptionModel.clinicId, clinicId))
      .limit(1);

    if (existing) {
      throw new HttpError(
        409,
        'This clinic already has a subscription. Use /subscribe to change plans.'
      );
    }

    const startDate = new Date();
    let expiresAt: Date | null = null;

    if (plan.slug === 'solo' || plan.slug === 'Free') {
      expiresAt = null;
    } else {
      const trialDays = plan.trialDays ?? 15;
      expiresAt = addDays(startDate, trialDays);
    }

    const [sub] = await database
      .insert(ClinicSubscriptionModel)
      .values({
        clinicId,
        planId,
        startsAt: startDate,
        expiresAt,
        active: true,
        provider: 'manual',
        providerSubscriptionId: 'manual',
        paymentMode: '-',
        transactionId: '-',
        paymentStatus: 'success',
        price: '0',
      })
      .returning();

    await redisClient.del(`clinic_active_subscription:${clinicId}`);
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_details:${clinicId}`);

    if (sub.active) {
      await SubscriptionService.updateUserSubscriptionExpiryCache(
        clinicId,
        sub.expiresAt
      );
    }

    return sendCreated(res, 'Subscription activated successfully', sub);
  }
);

// cancel clinic subscription
export const cancelClinicSubscription = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { subscriptionId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await SubscriptionService.cancelClinicSubscription(
      subscriptionId,
      clinicId
    );

    return sendOk(res, 'Clinic subscription cancelled successfully', {
      warnings: result.warnings,
    });
  }
);

// Schedule subscription cancellation at end of billing period
export const scheduleSubscriptionCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const reason = req.body?.reason;

    const subscription = await SubscriptionService.scheduleCancellation(
      clinicId,
      reason
    );

    return sendOk(
      res,
      'Subscription will be cancelled at end of current billing period',
      {
        subscription,
        cancelAtPeriodEnd: true,
        expiresAt: subscription.expiresAt,
      }
    );
  }
);

// Undo scheduled subscription cancellation
export const undoSubscriptionCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const subscription = await SubscriptionService.undoCancellation(clinicId);

    return sendOk(res, 'Subscription cancellation has been reversed', {
      subscription,
      cancelAtPeriodEnd: false,
    });
  }
);

// Subscribe to a paid plan WITH AutoPay (pay now + auto-renew).
// Creates a Razorpay recurring subscription and returns its hosted authorization
// URL. The plan is activated by the subscription.charged webhook.
export const subscribeWithAutoPay = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { planId, billingCycle, couponCode } = req.validatedBody;

    const { AutoRenewService } = await import('../services/autoRenew.service');
    const result = await AutoRenewService.subscribeWithAutoPay(
      clinicId,
      planId,
      billingCycle === 'yearly' ? 'yearly' : 'monthly',
      couponCode
    );

    return sendOk(res, 'AutoPay subscription created', {
      subscriptionId: result.subscriptionId,
      shortUrl: result.shortUrl,
      status: result.status,
      amount: result.amount,
      keyId: envConfig.RAZORPAY_KEY_ID,
      planId: result.planId,
      billingCycle: result.billingCycle,
      quote: result.quote,
    });
  }
);

// Pre-check plan downgrade limits & over-quota accounts before scheduling
export const checkPlanDowngrade = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { targetPlanId } = req.validatedBody;
    const { LimitationService } =
      await import('../services/limitation.service');

    const result = await LimitationService.checkDowngradeLimits(
      clinicId,
      targetPlanId
    );

    return sendOk(res, 'Downgrade resource check completed', result);
  }
);

// Schedule a plan downgrade at end of the current billing period.
// The current plan stays active until then. If AutoPay is on, the recurring
// mandate is cancelled at cycle end so the user isn't charged for the old plan.
export const schedulePlanDowngrade = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const {
      targetPlanId,
      billingCycle,
      preferredActiveStaffIds,
      preferredActiveDoctorIds,
    } = req.validatedBody;

    // Resolve the target plan's billing-cycle marker
    const [targetPlan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, targetPlanId))
      .limit(1);

    if (!targetPlan) {
      throw new HttpError(400, 'Invalid target plan');
    }

    const providerSubId =
      targetPlan.slug === 'solo' || targetPlan.slug === 'Free'
        ? PROVIDER_SUBSCRIPTION_ID.free
        : providerIdForCycle(billingCycle);

    const result = await SubscriptionService.schedulePlanChange(
      clinicId,
      targetPlanId,
      providerSubId,
      preferredActiveDoctorIds,
      preferredActiveStaffIds
    );

    // If AutoPay is on, stop the recurring mandate at cycle end so the user
    // isn't charged for the old (higher) plan on the next cycle. They can
    // re-enable AutoPay on the new plan after the change takes effect.
    try {
      const { AutoRenewService } =
        await import('../services/autoRenew.service');
      const status = await AutoRenewService.getAutoRenewStatus(clinicId);
      if (status.autoRenew) {
        await AutoRenewService.disableAutoRenew(clinicId);
      }
    } catch {
      // best-effort — scheduling still succeeds
    }

    return sendOk(res, 'Plan change scheduled for end of billing period', {
      scheduledPlan: {
        id: result.targetPlan.id,
        name: result.targetPlan.name,
        slug: result.targetPlan.slug,
      },
      effectiveAt: result.effectiveAt,
    });
  }
);

// Undo a scheduled plan downgrade
export const undoScheduledPlanChange = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    await SubscriptionService.undoScheduledPlanChange(clinicId);

    return sendOk(res, 'Scheduled plan change has been cancelled', {
      scheduledPlanId: null,
    });
  }
);

// Retry a failed / pending subscription payment
// Creates a fresh Razorpay order for the clinic's last unpaid subscription so
// the user can complete payment. Completion goes through /verify-subscription.
export const retrySubscriptionPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    // Find the most recent subscription record awaiting payment
    const [pendingSub] = await database
      .select({
        planId: ClinicSubscriptionModel.planId,
        paymentStatus: ClinicSubscriptionModel.paymentStatus,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        slug: SubscriptionPlanModel.slug,
        price: SubscriptionPlanModel.price,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          or(
            eq(ClinicSubscriptionModel.paymentStatus, 'pending'),
            eq(ClinicSubscriptionModel.paymentStatus, 'failed')
          )
        )
      )
      .orderBy(desc(ClinicSubscriptionModel.createdAt))
      .limit(1);

    if (!pendingSub) {
      throw new HttpError(404, 'No pending or failed payment found to retry.');
    }

    if (pendingSub.slug === 'solo' || pendingSub.slug === 'Free') {
      throw new HttpError(400, 'Free plan does not require payment.');
    }

    const price = planPriceForCycle(
      pendingSub.price,
      billingCycleFromProviderId(pendingSub.providerSubscriptionId)
    );

    const order = await createRazorpayOrder(
      price,
      clinicId,
      pendingSub.planId,
      pendingSub.providerSubscriptionId || PROVIDER_SUBSCRIPTION_ID.monthly
    );

    return sendOk(res, 'Retry payment order created', {
      requiresPayment: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      planId: pendingSub.planId,
      providerSubscriptionId: pendingSub.providerSubscriptionId,
    });
  }
);

// get all active subscriptions for a clinic
export const getClinicSubscription = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const now = new Date();

    const subscriptions = await database
      .select({
        id: ClinicSubscriptionModel.id,
        planId: ClinicSubscriptionModel.planId,
        planName: SubscriptionPlanModel.name,
        planSlug: SubscriptionPlanModel.slug,
        price: ClinicSubscriptionModel.price,
        startsAt: ClinicSubscriptionModel.startsAt,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        paymentMode: ClinicSubscriptionModel.paymentMode,
        paymentStatus: ClinicSubscriptionModel.paymentStatus,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        razorpaySubscriptionId: ClinicSubscriptionModel.razorpaySubscriptionId,
        cancelAtPeriodEnd: ClinicSubscriptionModel.cancelAtPeriodEnd,
        cancelledAt: ClinicSubscriptionModel.cancelledAt,
        autoRenew: ClinicSubscriptionModel.autoRenew,
        scheduledPlanId: ClinicSubscriptionModel.scheduledPlanId,
        scheduledPlanChangeAt: ClinicSubscriptionModel.scheduledPlanChangeAt,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .orderBy(desc(ClinicSubscriptionModel.createdAt))
      .limit(1);

    let activeSubscription = subscriptions[0] || null;

    // Self-healing check: Check Redis pending_autopay_subscription key FIRST, then active sub's razorpaySubscriptionId.
    // If Razorpay mandate is authorized/active for a plan upgrade (notes.planId !== activeSubscription.planId),
    // trigger initial AutoPay activation now so my-subscription immediately reflects the new plan.
    const redisPendingSubId = await redisClient.get(
      `pending_autopay_subscription:${clinicId}`
    );
    const pendingSubId =
      redisPendingSubId || activeSubscription?.razorpaySubscriptionId;

    if (pendingSubId) {
      try {
        const razorpaySub = (await razorpayInstance.subscriptions.fetch(
          pendingSubId
        )) as any;

        if (
          razorpaySub &&
          ['authenticated', 'active'].includes(razorpaySub.status)
        ) {
          const notes = razorpaySub.notes ?? {};
          const targetProviderSubId = providerIdForCycle(notes.billingCycle);
          const isPlanOrCycleChange =
            (notes.planId &&
              String(notes.planId) !== String(activeSubscription?.planId)) ||
            (notes.billingCycle &&
              targetProviderSubId !==
                activeSubscription?.providerSubscriptionId) ||
            !!redisPendingSubId;

          if (isPlanOrCycleChange) {
            const { AutoRenewService } =
              await import('../services/autoRenew.service');
            try {
              await AutoRenewService.activateInitialAutoPaySubscription(
                pendingSubId
              );
            } catch (err) {
              logger.warn(
                `getSubscriptionStatus: self-healing activation failed for pendingSubId=${pendingSubId}:`,
                err
              );
            }

            // Re-query active subscription after self-healing activation
            const updatedSubs = await database
              .select({
                id: ClinicSubscriptionModel.id,
                planId: ClinicSubscriptionModel.planId,
                planName: SubscriptionPlanModel.name,
                planSlug: SubscriptionPlanModel.slug,
                price: ClinicSubscriptionModel.price,
                startsAt: ClinicSubscriptionModel.startsAt,
                expiresAt: ClinicSubscriptionModel.expiresAt,
                paymentMode: ClinicSubscriptionModel.paymentMode,
                paymentStatus: ClinicSubscriptionModel.paymentStatus,
                providerSubscriptionId:
                  ClinicSubscriptionModel.providerSubscriptionId,
                razorpaySubscriptionId:
                  ClinicSubscriptionModel.razorpaySubscriptionId,
                cancelAtPeriodEnd: ClinicSubscriptionModel.cancelAtPeriodEnd,
                cancelledAt: ClinicSubscriptionModel.cancelledAt,
                autoRenew: ClinicSubscriptionModel.autoRenew,
                scheduledPlanId: ClinicSubscriptionModel.scheduledPlanId,
                scheduledPlanChangeAt:
                  ClinicSubscriptionModel.scheduledPlanChangeAt,
              })
              .from(ClinicSubscriptionModel)
              .innerJoin(
                SubscriptionPlanModel,
                eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
              )
              .where(
                and(
                  eq(ClinicSubscriptionModel.clinicId, clinicId),
                  eq(ClinicSubscriptionModel.active, true)
                )
              )
              .orderBy(desc(ClinicSubscriptionModel.createdAt))
              .limit(1);

            if (updatedSubs.length > 0) {
              activeSubscription = updatedSubs[0];
            }
          }
        }
      } catch (err: any) {
        logger.warn(
          `getClinicSubscription: error reconciling subscription ${pendingSubId}: ${err?.message || err}`
        );
        if (
          err?.statusCode === 400 ||
          err?.error?.code === 'BAD_REQUEST_ERROR'
        ) {
          if (
            activeSubscription?.razorpaySubscriptionId === pendingSubId &&
            activeSubscription.id
          ) {
            await database
              .update(ClinicSubscriptionModel)
              .set({
                razorpaySubscriptionId: null,
                autoRenew: false,
                updatedAt: new Date(),
              })
              .where(eq(ClinicSubscriptionModel.id, activeSubscription.id));
            activeSubscription.razorpaySubscriptionId = null;
            activeSubscription.autoRenew = false;
          }
          if (redisPendingSubId === pendingSubId) {
            await redisClient.del(`pending_autopay_subscription:${clinicId}`);
          }
        }
      }
    }

    const isWithinPeriod =
      activeSubscription !== null &&
      isSubscriptionValid(activeSubscription.expiresAt, now);

    // Add-ons are only valid for paid plans whose period is still running —
    // the same condition the expiry-filtered query used to express.
    const isPaidPlan =
      isWithinPeriod &&
      activeSubscription?.planSlug !== 'solo' &&
      activeSubscription?.planSlug !== 'Free';

    // Fetch active add-ons for this clinic (paid plans only)
    const clinicAddOns = isPaidPlan
      ? await database
          .select({
            id: ClinicAddOnModel.id,
            addOnName: AddOnModel.name,
            featureKey: AddOnModel.featureKey,
            quantity: ClinicAddOnModel.quantity,
            billingCycle: ClinicAddOnModel.billingCycle,
            expiresAt: ClinicAddOnModel.expiresAt,
            // What was paid — pro-rated to the days left when it was bought.
            price: ClinicAddOnModel.price,
            // What it costs per cycle from here on. Renewals charge the full
            // catalogue rate (see `computeAddOnRecurringTotal`), so the paid
            // figure above must never be presented as the next charge.
            monthlyPrice: AddOnModel.monthlyPrice,
            yearlyPrice: AddOnModel.yearlyPrice,
            cancelAtPeriodEnd: ClinicAddOnModel.cancelAtPeriodEnd,
            cancelledAt: ClinicAddOnModel.cancelledAt,
          })
          .from(ClinicAddOnModel)
          .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
          .where(
            and(
              eq(ClinicAddOnModel.clinicId, clinicId),
              eq(ClinicAddOnModel.isActive, true)
            )
          )
      : [];

    // Filter out expired add-ons and group by featureKey
    const activeAddOns = clinicAddOns.filter(
      (a) => !a.expiresAt || new Date(a.expiresAt) > now
    );

    // Group add-ons by featureKey and sum quantities
    const groupedAddOns = Object.values(
      activeAddOns.reduce(
        (acc, addOn) => {
          if (!acc[addOn.featureKey]) {
            acc[addOn.featureKey] = {
              id: addOn.id,
              addOnName: addOn.addOnName,
              featureKey: addOn.featureKey,
              totalQuantity: 0,
              renewalQuantity: 0,
              billingCycle: addOn.billingCycle,
              latestExpiresAt: addOn.expiresAt,
              totalPrice: 0,
              recurringPrice: 0,
              cancelAtPeriodEnd: addOn.cancelAtPeriodEnd || false,
              cancelledAt: addOn.cancelledAt || null,
            };
          }
          acc[addOn.featureKey].totalQuantity += addOn.quantity;
          if (!addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].renewalQuantity += addOn.quantity;
          }
          acc[addOn.featureKey].totalPrice += Number(addOn.price);
          // Full rate × quantity — what this add-on adds to every renewal.
          acc[addOn.featureKey].recurringPrice +=
            Number(
              addOn.billingCycle === 'yearly'
                ? addOn.yearlyPrice
                : addOn.monthlyPrice
            ) * addOn.quantity;
          // If any record for this feature is marked for cancellation, reflect it
          if (addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].cancelAtPeriodEnd = true;
            acc[addOn.featureKey].cancelledAt = addOn.cancelledAt;
          }
          // Keep the latest expiry date
          if (
            addOn.expiresAt &&
            (!acc[addOn.featureKey].latestExpiresAt ||
              new Date(addOn.expiresAt) >
                new Date(acc[addOn.featureKey].latestExpiresAt!))
          ) {
            acc[addOn.featureKey].latestExpiresAt = addOn.expiresAt;
          }
          return acc;
        },
        {} as Record<
          string,
          {
            id: string;
            addOnName: string;
            featureKey: string;
            totalQuantity: number;
            renewalQuantity: number;
            billingCycle: string;
            latestExpiresAt: Date | null;
            totalPrice: number;
            recurringPrice: number;
            cancelAtPeriodEnd: boolean;
            cancelledAt: Date | null;
          }
        >
      )
    );

    return sendOk(res, 'Clinic subscription fetched successfully', {
      subscription: activeSubscription,
      hasActive: isWithinPeriod,
      addOns: groupedAddOns,
      usage: await (async () => {
        const { LimitationService } =
          await import('../services/limitation.service');
        const doctorCheck = await LimitationService.checkDoctorLimit(clinicId);
        const staffCheck = await LimitationService.checkStaffLimit(clinicId);
        const storageCheck = await LimitationService.checkStorageLimit(
          clinicId,
          0
        );

        return {
          doctors: {
            current: doctorCheck.currentUsage,
            limit: doctorCheck.limit,
            isUnlimited: doctorCheck.isUnlimited,
            remaining: doctorCheck.remaining,
          },
          staff: {
            current: staffCheck.currentUsage,
            limit: staffCheck.limit,
            isUnlimited: staffCheck.isUnlimited,
            remaining: staffCheck.remaining,
          },
          storage: {
            current: storageCheck.currentUsage,
            limit: storageCheck.limit,
            isUnlimited: storageCheck.isUnlimited,
            remaining: storageCheck.remaining,
            usedMB: storageCheck.usedMB,
            limitMB: storageCheck.limitMB,
            remainingMB: storageCheck.remainingMB,
            unit: 'MB',
          },
        };
      })(),
    });
  }
);

// get billing history for a clinic
/**
 * GET /api/v1/subscription/activity
 *
 * The subscription activity timeline. Reads the append-only audit log rather
 * than deriving events from current state, so actions that move no money
 * (AutoPay toggles, cancellation, undo, scheduled add-on removal) are visible
 * and keep the date they actually happened.
 */
export const getSubscriptionActivity = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const limitRaw = Number(req.query.limit);
    const beforeRaw =
      typeof req.query.before === 'string' ? new Date(req.query.before) : null;

    const activity = await SubscriptionActivityService.list(clinicId, {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      before:
        beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined,
    });

    return sendOk(res, 'Subscription activity fetched successfully', activity);
  }
);

export const getBillingHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const history = await SubscriptionService.getClinicBillingHistory(clinicId);

    return sendOk(res, 'Billing history fetched successfully', history);
  }
);

export const downloadInvoicePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { invoiceId } = req.params;
    const { type } = req.query;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    if (!invoiceId) {
      throw new HttpError(400, 'Invoice ID required');
    }

    const { pdfBuffer, fileName } =
      await SubscriptionService.generateInvoicePdf(
        clinicId,
        String(invoiceId),
        type as 'subscription' | 'addon' | undefined
      );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return res.status(200).send(pdfBuffer);
  }
);
