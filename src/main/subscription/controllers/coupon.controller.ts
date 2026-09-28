// src/main/subscription/controllers/coupon.controller.ts
import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { couponService } from '../services/coupon.service';

// ==================== Admin Controllers ====================

/**
 * Create a new coupon
 * POST /api/v1/subscription/coupons
 */
export const createCoupon = asyncHandler(
  async (req: Request, res: Response) => {
    const adminId = req.user?.id;

    if (!adminId) {
      throw new HttpError(401, 'Authentication required');
    }

    // Transform API input to match DB types
    const body = req.validatedBody;
    const couponData = {
      ...body,
      discountValue: body.discountValue?.toString(),
      maxDiscountAmount: body.maxDiscountAmount?.toString(),
      minOrderValue: body.minOrderValue?.toString(),
      startsAt: new Date(body.startsAt),
      expiresAt: new Date(body.expiresAt),
    };

    const result = await couponService.createCoupon(couponData, adminId);

    if (!result.success) {
      throw new HttpError(
        result.code === 'DUPLICATE_CODE' ? 409 : 400,
        result.error || 'Failed to create coupon'
      );
    }

    return sendCreated(res, 'Coupon created successfully', result.data);
  }
);

/**
 * Get all coupons with pagination
 * GET /api/v1/subscription/coupons
 */
export const getAllCoupons = asyncHandler(
  async (req: Request, res: Response) => {
    const { page, limit, status } = req.validatedQuery || {};

    const result = await couponService.getAllCoupons(
      parseInt(page || '1'),
      Math.min(parseInt(limit || '50'), 100),
      status
    );

    if (!result.success) {
      throw new HttpError(500, result.error || 'Failed to get coupons');
    }

    return sendOk(res, 'Coupons fetched successfully', result.data);
  }
);

/**
 * Get single coupon by ID
 * GET /api/v1/subscription/coupons/:id
 */
export const getCouponById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;

    const result = await couponService.getCouponById(parseInt(id));

    if (!result.success) {
      throw new HttpError(404, result.error || 'Coupon not found');
    }

    return sendOk(res, 'Coupon fetched successfully', result.data);
  }
);

/**
 * Update a coupon
 * PATCH /api/v1/subscription/coupons/:id
 */
export const updateCoupon = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;

    // Transform API input to match DB types (only present fields)
    const body = req.validatedBody;
    const updateData: Record<string, unknown> = { ...body };
    if (body.discountValue !== undefined)
      updateData.discountValue = body.discountValue.toString();
    if (body.maxDiscountAmount !== undefined)
      updateData.maxDiscountAmount = body.maxDiscountAmount.toString();
    if (body.minOrderValue !== undefined)
      updateData.minOrderValue = body.minOrderValue.toString();
    if (body.startsAt) updateData.startsAt = new Date(body.startsAt);
    if (body.expiresAt) updateData.expiresAt = new Date(body.expiresAt);

    const result = await couponService.updateCoupon(parseInt(id), updateData);

    if (!result.success) {
      throw new HttpError(
        result.code === 'NOT_FOUND' ? 404 : 400,
        result.error || 'Failed to update coupon'
      );
    }

    return sendOk(res, 'Coupon updated successfully', result.data);
  }
);

/**
 * Delete a coupon (soft delete)
 * DELETE /api/v1/subscription/coupons/:id
 */
export const deleteCoupon = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;

    const result = await couponService.deleteCoupon(parseInt(id));

    if (!result.success) {
      throw new HttpError(404, result.error || 'Coupon not found');
    }

    return sendOk(res, 'Coupon deleted successfully', null);
  }
);

/**
 * Get coupon usage statistics
 * GET /api/v1/subscription/coupons/:id/stats
 */
export const getCouponStats = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;

    const result = await couponService.getCouponStats(parseInt(id));

    if (!result.success) {
      throw new HttpError(500, result.error || 'Failed to get statistics');
    }

    return sendOk(res, 'Coupon statistics fetched successfully', result.data);
  }
);

// ==================== Clinic Controllers ====================

/**
 * Validate/apply a coupon code
 * POST /api/v1/subscription/coupons/validate
 */
export const validateCoupon = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { code, planId, addOnId, billingCycle, orderValue } =
      req.validatedBody;

    const result = await couponService.validateCoupon({
      code,
      clinicId,
      orderValue,
      planId,
      addOnId,
      billingCycle,
    });

    if (!result.valid) {
      return sendOk(res, result.message || 'Coupon is not valid', {
        valid: false,
        discountAmount: 0,
        finalAmount: orderValue,
        code: result.code,
      });
    }

    return sendOk(res, 'Coupon is valid', {
      valid: true,
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
      coupon: {
        id: result.coupon?.id,
        code: result.coupon?.code,
        discountType: result.coupon?.discountType,
        discountValue: result.coupon?.discountValue,
        description: result.coupon?.description,
      },
    });
  }
);

/**
 * Get clinic's coupon usage history
 * GET /api/v1/subscription/coupons/my-history
 */
export const getMyCouponHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const page = parseInt((req.query.page as string) || '1');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 50);

    const result = await couponService.getClinicCouponHistory(
      clinicId,
      page,
      limit
    );

    if (!result.success) {
      throw new HttpError(500, result.error || 'Failed to get history');
    }

    return sendOk(res, 'Coupon history fetched successfully', result.data);
  }
);
