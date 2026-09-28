import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { envConfig } from '../../../utils/envConfig';
import { database } from '../../../configurations/dbConnection';
import { SubscriptionService } from '../services/subscription.service';
import { PricingService } from '../services/pricing.service';
import {
  SubscriptionPlanModel,
  ClinicSubscriptionModel,
} from '../models/subscription.model';
import { PlanFeaturesModel } from '../models/planFeatures.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import { and, eq, inArray } from 'drizzle-orm';
import { FEATURE_KEYS } from '../services/limitation.service';
import { createRazorpayOrder } from '../../../utils/razorpay';
import {
  assertOrderCoversAmount,
  encodeAddOnItems,
  resolveVerifiedOrder,
} from '../utils/razorpayOrder.utils';
import {
  billingCycleFromProviderId,
  planPriceForCycle,
  providerIdForCycle,
  yearlySavings,
} from '../utils/billingCycle.utils';

// ==========================================
// COMBINED SUBSCRIPTION + ADD-ONS PURCHASE
// ==========================================

/**
 * Subscribe to plan with optional add-ons in ONE API call
 * POST /api/v1/subscription/subscribe-with-addons
 */
export const subscribeWithAddOns = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId, billingCycle = 'monthly', addOns = [] } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    // Get plan details
    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    const subscriptionPrice = planPriceForCycle(plan.price, billingCycle);

    // Calculate add-ons total
    let addOnsTotal = 0;
    const addOnDetails = [];

    for (const addOnItem of addOns) {
      const [addOn] = await database
        .select()
        .from(AddOnModel)
        .where(eq(AddOnModel.id, addOnItem.addOnId))
        .limit(1);

      if (!addOn || !addOn.isActive) {
        throw new HttpError(
          400,
          `Invalid or inactive add-on: ${addOnItem.addOnId}`
        );
      }

      const unitPrice =
        billingCycle === 'yearly'
          ? Number(addOn.yearlyPrice)
          : Number(addOn.monthlyPrice);

      const totalPrice = unitPrice * addOnItem.quantity;
      addOnsTotal += totalPrice;

      addOnDetails.push({
        addOnId: addOn.id,
        name: addOn.name,
        featureKey: addOn.featureKey,
        unitPrice,
        quantity: addOnItem.quantity,
        totalPrice,
        billingCycle,
      });
    }

    const grandTotal = subscriptionPrice + addOnsTotal;

    // Free plan with no add-ons - create subscription directly
    if ((plan.slug === 'solo' || plan.slug === 'Free') && addOns.length === 0) {
      const sub = await SubscriptionService.subscribeClinic({
        clinicId,
        planId,
        provider: 'manual',
        providerSubscriptionId: 'free_plan',
        paymentMode: 'free',
        paymentStatus: 'success',
      });

      return sendCreated(res, 'Free subscription activated', {
        subscription: sub,
        addOns: [],
        totalAmount: 0,
      });
    }

    // Free plan CANNOT have add-ons (must have paid subscription with add-on access)
    if (addOns.length > 0) {
      const [addOnFeature] = await database
        .select({ enabled: PlanFeaturesModel.enabled })
        .from(PlanFeaturesModel)
        .where(
          and(
            eq(PlanFeaturesModel.planId, planId),
            eq(PlanFeaturesModel.featureKey, FEATURE_KEYS.ADD_ONS)
          )
        )
        .limit(1);

      if (
        addOnFeature
          ? !addOnFeature.enabled
          : plan.slug === 'solo' || plan.slug === 'Free'
      ) {
        throw new HttpError(
          400,
          'Add-ons are not available on the selected plan. Please choose a plan that supports add-ons.'
        );
      }
    }

    // The order notes are the authoritative record of what was bought —
    // verification reads the plan, cycle and add-on quantities back from here.
    const order = await createRazorpayOrder(
      grandTotal,
      clinicId,
      planId,
      providerIdForCycle(billingCycle),
      addOns.length > 0
        ? {
            addOnItems: encodeAddOnItems(
              addOnDetails.map((a) => ({
                addOnId: a.addOnId,
                quantity: a.quantity,
                billingCycle,
              }))
            ),
          }
        : undefined
    );

    return sendOk(res, 'Payment order created', {
      requiresPayment: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      breakdown: {
        plan: {
          id: plan.id,
          name: plan.name,
          billingCycle,
          price: subscriptionPrice,
        },
        addOns: addOnDetails,
        subscriptionPrice,
        addOnsTotal,
        grandTotal,
      },
    });
  }
);

/**
 * Verify combined subscription + add-ons purchase
 * POST /api/v1/subscription/verify-combined-purchase
 */
export const verifyCombinedPurchase = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { orderId, paymentId, signature } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    // Plan, billing cycle and add-on quantities come from the order notes, not
    // from the request body — the signature does not bind them.
    const verifiedOrder = await resolveVerifiedOrder({
      orderId,
      paymentId,
      signature,
      clinicId,
    });

    const planId = verifiedOrder.planId;
    const billingCycle = billingCycleFromProviderId(
      verifiedOrder.providerSubscriptionId
    );
    const addOns = verifiedOrder.addOnItems;

    if (!planId) {
      throw new HttpError(400, 'Payment order is not a subscription purchase');
    }

    // Check for duplicate subscription
    const existingSubscription = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(eq(ClinicSubscriptionModel.transactionId, paymentId))
      .limit(1);

    if (existingSubscription.length > 0) {
      return sendOk(res, 'Subscription already activated', {
        subscription: existingSubscription[0],
      });
    }

    // Get plan
    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    const subscriptionPrice = planPriceForCycle(plan.price, billingCycle);

    const purchasedAddOns =
      addOns.length > 0
        ? await database
            .select()
            .from(AddOnModel)
            .where(
              inArray(
                AddOnModel.id,
                addOns.map((item) => item.addOnId)
              )
            )
        : [];

    const addOnLines = addOns.flatMap((item) => {
      const addOn = purchasedAddOns.find((row) => row.id === item.addOnId);
      if (!addOn) return [];

      const unitPrice =
        billingCycle === 'yearly'
          ? Number(addOn.yearlyPrice)
          : Number(addOn.monthlyPrice);

      return [{ addOn, item, totalPrice: unitPrice * item.quantity }];
    });

    assertOrderCoversAmount(
      verifiedOrder,
      subscriptionPrice +
        addOnLines.reduce((sum, line) => sum + line.totalPrice, 0)
    );

    // Deactivate existing subscriptions
    await database
      .update(ClinicSubscriptionModel)
      .set({
        active: false,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSubscriptionModel.clinicId, clinicId));

    // Create subscription
    const [subscription] = await database
      .insert(ClinicSubscriptionModel)
      .values({
        clinicId,
        planId,
        startsAt: new Date(),
        expiresAt:
          billingCycle === 'yearly'
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        active: true,
        provider: 'razorpay',
        providerSubscriptionId: providerIdForCycle(billingCycle),
        paymentMode: 'online',
        transactionId: paymentId,
        paymentStatus: 'success',
        price: String(subscriptionPrice),
      })
      .returning();

    // Process add-ons
    const activatedAddOns = [];

    for (const { addOn, item: addOnItem, totalPrice } of addOnLines) {
      const [clinicAddOn] = await database
        .insert(ClinicAddOnModel)
        .values({
          clinicId,
          addOnId: addOn.id,
          quantity: addOnItem.quantity,
          billingCycle,
          startsAt: new Date(),
          expiresAt:
            billingCycle === 'yearly'
              ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isActive: true,
          provider: 'razorpay',
          providerSubscriptionId: orderId,
          paymentStatus: 'success',
          paymentMode: 'online',
          transactionId: paymentId,
          price: String(totalPrice),
        })
        .returning();

      activatedAddOns.push({
        ...clinicAddOn,
        addOn: {
          name: addOn.name,
          featureKey: addOn.featureKey,
        },
      });
    }

    // Clear cache
    const redisClient = (await import('../../../configurations/redisConfig'))
      .default;
    await redisClient.del(`clinic_plan:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);
    await redisClient.del(`clinic_addons:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    return sendCreated(res, 'Subscription and add-ons activated successfully', {
      subscription: {
        ...subscription,
        plan: {
          name: plan.name,
          slug: plan.slug,
        },
      },
      addOns: activatedAddOns,
      totalAmount:
        subscriptionPrice +
        activatedAddOns.reduce((sum, a) => sum + Number(a.price), 0),
    });
  }
);

/**
 * Price a plan purchase without creating an order.
 * POST /api/v1/subscription/quote
 *
 * The only place the UI should get a plan price from: it runs the same
 * `PricingService.quotePlanPurchase` the checkout does, so what the clinic is
 * shown is by construction what it will be charged.
 */
export const quotePlanPurchase = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId, billingCycle, couponCode } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const quote = await PricingService.quotePlanPurchase({
      clinicId,
      planId,
      billingCycle,
      couponCode,
    });

    return sendOk(res, 'Plan quote', quote);
  }
);

/**
 * Get combined pricing preview (without creating order)
 * POST /api/v1/subscription/preview-combined-price
 */
export const previewCombinedPrice = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId, billingCycle = 'monthly', addOns = [] } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    // Get plan
    const plan = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1)
      .then((res) => res[0]);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    // Cycle pricing comes from the shared helper — an inline copy of the
    // formula here is how the discount rate drifted between call sites before.
    const subscriptionPrice = planPriceForCycle(plan.price, billingCycle);

    let addOnsTotal = 0;
    const addOnDetails = [];

    for (const addOnItem of addOns) {
      const [addOn] = await database
        .select()
        .from(AddOnModel)
        .where(eq(AddOnModel.id, addOnItem.addOnId))
        .limit(1);

      if (!addOn || !addOn.isActive) continue;

      const unitPrice =
        billingCycle === 'yearly'
          ? Number(addOn.yearlyPrice)
          : Number(addOn.monthlyPrice);

      const totalPrice = unitPrice * addOnItem.quantity;
      addOnsTotal += totalPrice;

      addOnDetails.push({
        addOnId: addOn.id,
        name: addOn.name,
        featureKey: addOn.featureKey,
        unitPrice,
        quantity: addOnItem.quantity,
        totalPrice,
        billingCycle,
      });
    }

    return sendOk(res, 'Pricing preview', {
      plan: {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        billingCycle,
        price: subscriptionPrice,
      },
      addOns: addOnDetails,
      subscriptionPrice,
      addOnsTotal,
      grandTotal: subscriptionPrice + addOnsTotal,
      savings: yearlySavings(plan.price, billingCycle),
    });
  }
);
