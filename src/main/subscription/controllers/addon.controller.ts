import { Request, Response } from 'express';
import { AddOnService, ADD_ON_PRICING } from '../services/addon.service';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { envConfig } from '../../../utils/envConfig';
import { database } from '../../../configurations/dbConnection';
import {
  AddOnModel,
  type AddOn,
  type ClinicAddOn,
} from '../models/addon.model';
import { eq } from 'drizzle-orm';
import { resolveVerifiedOrder } from '../utils/razorpayOrder.utils';
import { couponService } from '../services/coupon.service';

// ==================== Admin Controllers ====================

/**
 * Create a new add-on
 * POST /api/v1/users/addons
 */
export const createAddOn = asyncHandler(async (req: Request, res: Response) => {
  const addOn = await AddOnService.createAddOn(req.validatedBody);
  return sendCreated(res, 'Add-on created successfully', addOn);
});

/**
 * Get all add-ons (admin view)
 * GET /api/v1/users/addons
 */
export const getAllAddOns = asyncHandler(
  async (_req: Request, res: Response) => {
    const addOns = await AddOnService.getAllAddOns();
    return sendOk(res, 'Add-ons fetched successfully', addOns);
  }
);

/**
 * Get active add-ons
 * GET /api/v1/users/addons/active
 */
export const getActiveAddOns = asyncHandler(
  async (_req: Request, res: Response) => {
    const addOns = await AddOnService.getActiveAddOns();
    return sendOk(res, 'Active add-ons fetched successfully', addOns);
  }
);

/**
 * Update an add-on
 * PATCH /api/v1/users/addons/:id
 */
export const updateAddOn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const addOn = await AddOnService.updateAddOn(id, req.validatedBody);
  return sendOk(res, 'Add-on updated successfully', addOn);
});

/**
 * Delete an add-on (soft delete)
 * DELETE /api/v1/users/addons/:id
 */
export const deleteAddOn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const addOn = await AddOnService.deleteAddOn(id);
  return sendOk(res, 'Add-on deleted successfully', addOn);
});

// ==================== Clinic Controllers ====================

/**
 * Get available add-ons for purchase
 * GET /api/v1/users/addons/available
 */
export const getAvailableAddOns = asyncHandler(
  async (_req: Request, res: Response) => {
    const addOns = await AddOnService.getAvailableAddOns();

    // Get pricing info
    const addOnsWithPricing = addOns.map((addOn: AddOn) => ({
      ...addOn,
      pricing:
        ADD_ON_PRICING[addOn.featureKey as keyof typeof ADD_ON_PRICING] || null,
    }));

    return sendOk(
      res,
      'Available add-ons fetched successfully',
      addOnsWithPricing
    );
  }
);

/**
 * Get clinic's purchased add-ons
 * GET /api/v1/users/addons/my-addons
 */
export const getMyAddOns = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = req.clinicId;

  if (!clinicId) {
    throw new HttpError(400, 'Clinic context required');
  }

  const addOns = await AddOnService.getClinicAddOns(clinicId);

  // Get detailed info for each
  const detailedAddOns = await Promise.all(
    addOns.map(async (clinicAddOn: ClinicAddOn) => {
      const [addOn] = await database
        .select()
        .from(AddOnModel)
        .where(eq(AddOnModel.id, clinicAddOn.addOnId))
        .limit(1);

      return {
        ...clinicAddOn,
        addOn: addOn || null,
        isExpired: clinicAddOn.expiresAt
          ? new Date(clinicAddOn.expiresAt) < new Date()
          : false,
      };
    })
  );

  return sendOk(res, 'Your add-ons fetched successfully', detailedAddOns);
});

/**
 * Initiate add-on purchase
 * POST /api/v1/subscription/addons/purchase
 */
export const purchaseAddOn = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { addOns, couponCode } = req.validatedBody;

    // Price first, then coupon, then order — the discount has to be baked into
    // the Razorpay order amount, otherwise the customer is charged full price.
    const quote = await AddOnService.quoteAddOnPurchase(clinicId, addOns);

    let discountInfo: {
      couponId: number;
      couponCode: string;
      discountAmount: number;
      originalAmount: number;
      finalAmount: number;
    } | null = null;

    if (couponCode) {
      // Use the first addOn ID for coupon applicability check
      const firstAddOnId = addOns[0]?.addOnId || undefined;

      const couponResult = await couponService.applyCoupon({
        code: couponCode,
        clinicId,
        orderValue: quote.totalPrice,
        addOnId: firstAddOnId,
        billingCycle: addOns[0]?.billingCycle,
      });

      if (!couponResult.success || !couponResult.data) {
        throw new HttpError(400, couponResult.error || 'Invalid coupon code');
      }

      discountInfo = {
        couponId: couponResult.data.couponId,
        couponCode: couponResult.data.couponCode,
        discountAmount: couponResult.data.discountAmount,
        originalAmount: quote.totalPrice,
        finalAmount: couponResult.data.finalAmount,
      };
    }

    const result = await AddOnService.createAddOnOrder(
      clinicId,
      quote,
      discountInfo ?? undefined
    );

    return sendOk(res, 'Add-on purchase initiated', {
      orderId: result.orderId,
      amount: result.amount,
      currency: result.currency,
      keyId: envConfig.RAZORPAY_KEY_ID,
      addOns: result.addOns,
      discount: discountInfo
        ? {
            couponCode: discountInfo.couponCode,
            couponId: discountInfo.couponId,
            discountAmount: discountInfo.discountAmount,
            originalAmount: discountInfo.originalAmount,
            finalAmount: discountInfo.finalAmount,
          }
        : undefined,
    });
  }
);

/**
 * Price an add-on selection without creating an order.
 * POST /api/v1/subscription/addons/quote
 *
 * Add-on pricing is pro-rated to the days left before the plan renews, so the
 * catalogue price is never what the clinic actually pays. This runs the same
 * `quoteAddOnPurchase` the purchase endpoint does — minus the Razorpay order —
 * so the drawer can show the real figure before anyone commits to paying it.
 */
export const quoteAddOns = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = req.clinicId;

  if (!clinicId) {
    throw new HttpError(400, 'Clinic context required');
  }

  const { addOns, couponCode } = req.validatedBody;

  const quote = await AddOnService.quoteAddOnPurchase(clinicId, addOns);

  // Validate only — applying would record usage against a purchase that has
  // not happened yet.
  let discount: {
    couponCode: string;
    couponId: number | null;
    discountAmount: number;
  } | null = null;

  if (couponCode && quote.totalPrice > 0) {
    const validation = await couponService.validateCoupon({
      code: couponCode,
      clinicId,
      orderValue: quote.totalPrice,
      addOnId: addOns[0]?.addOnId || undefined,
      billingCycle: addOns[0]?.billingCycle,
    });

    if (validation.valid) {
      discount = {
        couponCode: validation.coupon?.code ?? couponCode,
        couponId: validation.coupon?.id ?? null,
        discountAmount: validation.discountAmount ?? 0,
      };
    }
  }

  const discountAmount = discount?.discountAmount ?? 0;

  return sendOk(res, 'Add-on quote', {
    currency: quote.currency,
    addOns: quote.addOns,
    /** Sum of the catalogue prices, for showing what the proration saved. */
    fullPrice: quote.addOns.reduce((sum, a) => sum + a.fullPrice, 0),
    /** Pro-rated sum before any coupon. */
    subtotal: quote.totalPrice,
    discountAmount,
    totalPayable: Math.max(0, quote.totalPrice - discountAmount),
    discount,
  });
});

/**
 * Verify payment and complete add-on purchase
 * POST /api/v1/subscription/addons/verify-purchase
 */
export const verifyPurchase = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { orderId, paymentId, signature } = req.validatedBody;

    // Which add-ons (and how many) were paid for is read from the order notes,
    // never from the request body.
    const verifiedOrder = await resolveVerifiedOrder({
      orderId,
      paymentId,
      signature,
      clinicId,
    });

    const addOns = verifiedOrder.addOnItems;

    if (addOns.length === 0) {
      throw new HttpError(400, 'Payment order has no add-ons to activate');
    }

    // Complete the purchase for all add-ons
    const result = await AddOnService.completePurchase(
      clinicId,
      addOns,
      paymentId,
      orderId
    );

    // Record coupon usage if a coupon was applied when the order was created
    const orderCoupon = verifiedOrder.coupon;
    if (orderCoupon) {
      await couponService.recordUsage({
        couponId: orderCoupon.couponId,
        clinicId,
        addOnId: addOns[0]?.addOnId,
        orderValue: orderCoupon.originalAmount,
        discountAmount: orderCoupon.discountAmount,
        finalAmount: orderCoupon.originalAmount - orderCoupon.discountAmount,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        billingCycle: addOns[0]?.billingCycle,
      });
    }

    return sendOk(res, 'Add-ons purchased successfully', result);
  }
);

/**
 * Get cancellation/reduction preview and eligible accounts to deactivate
 * GET /api/v1/subscription/addons/cancellation-preview/:clinicAddOnId
 */
export const getAddOnCancellationPreview = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const reduceBy = req.query.reduceBy
      ? parseInt(req.query.reduceBy as string, 10)
      : undefined;

    const result = await AddOnService.getCancellationPreview(
      clinicAddOnId,
      clinicId,
      reduceBy
    );

    return sendOk(
      res,
      'Add-on cancellation preview computed successfully',
      result
    );
  }
);

/**
 * Reduce quantity of an active add-on
 * PUT /api/v1/subscription/addons/reduce-quantity/:clinicAddOnId
 */
export const reduceAddOnQuantity = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const reduceBy = req.body?.reduceBy ?? 1;
    const deactivateUserIds = req.body?.deactivateUserIds ?? [];

    const result = await AddOnService.reduceAddOnQuantity(
      clinicAddOnId,
      clinicId,
      reduceBy,
      deactivateUserIds
    );

    const message = result.scheduled
      ? 'Last unit removed — add-on will be cancelled at end of billing period'
      : `Add-on quantity reduced to ${result.quantity}`;

    return sendOk(res, message, result);
  }
);

/**
 * Schedule add-on cancellation at end of billing period
 * PUT /api/v1/subscription/addons/schedule-cancel/:clinicAddOnId
 */
export const scheduleAddOnCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const reason = req.body?.reason;
    const deactivateUserIds = req.body?.deactivateUserIds ?? [];

    const result = await AddOnService.scheduleCancelAddOn(
      clinicAddOnId,
      clinicId,
      reason,
      deactivateUserIds
    );

    return sendOk(
      res,
      'Add-on will be cancelled at end of current billing period',
      result
    );
  }
);

/**
 * Undo scheduled add-on cancellation
 * PUT /api/v1/subscription/addons/undo-cancel/:clinicAddOnId
 */
export const undoAddOnCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await AddOnService.undoCancelAddOn(clinicAddOnId, clinicId);

    return sendOk(res, 'Add-on cancellation has been reversed', result);
  }
);

/**
 * Cancel an add-on subscription (immediate)
 * PUT /api/v1/users/addons/cancel/:clinicAddOnId
 */
export const cancelAddOn = asyncHandler(async (req: Request, res: Response) => {
  const { clinicAddOnId } = req.validatedParams;
  const clinicId = req.clinicId;

  const result = await AddOnService.cancelAddOn(clinicAddOnId, clinicId);

  return sendOk(res, 'Add-on cancelled successfully', result);
});

/**
 * Get clinic's add-on limits breakdown
 * GET /api/v1/users/addons/limits
 */
export const getAddOnLimits = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const limits = await AddOnService.getClinicAddOnLimits(clinicId);

    return sendOk(res, 'Add-on limits fetched successfully', limits);
  }
);

/**
 * Get add-on pricing info
 * GET /api/v1/users/addons/pricing
 */
export const getAddOnPricing = asyncHandler(
  async (_req: Request, res: Response) => {
    return sendOk(res, 'Add-on pricing fetched successfully', ADD_ON_PRICING);
  }
);
