import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  createCoupon,
  deleteCoupon,
  getAllCoupons,
  getCouponStats,
  updateCoupon,
  validateCoupon,
} from '../../controllers/coupon.controller';
import {
  couponIdParamsSchema,
  createCouponSchema,
  getCouponsQuerySchema,
  updateCouponSchema,
  validateCouponSchema,
} from '../../schemas/coupon.schemas';

const couponsRouter = express.Router();

/**
 * @route POST /api/v1/subscription/coupons/validate
 * @desc Validate/apply a coupon code for a purchase
 * @access Private (Clinic)
 */
couponsRouter.post(
  '/validate',
  requireAuth,
  requireBillingAdmin,
  requireClinic,
  validate(validateCouponSchema, 'body'),
  validateCoupon
);

/**
 * @route POST /api/v1/subscription/coupons
 * @desc Create a new coupon
 * @access Private (Super Admin)
 */
couponsRouter.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(createCouponSchema, 'body'),
  createCoupon
);

/**
 * @route GET /api/v1/subscription/coupons
 * @desc Get all coupons with pagination and filtering
 * @access Private (Super Admin)
 */
couponsRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(getCouponsQuerySchema, 'query'),
  getAllCoupons
);

/**
 * @route PATCH /api/v1/subscription/coupons/:id
 * @desc Update a coupon
 * @access Private (Super Admin)
 */
couponsRouter.patch(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  validate(couponIdParamsSchema, 'params'),
  validate(updateCouponSchema, 'body'),
  updateCoupon
);

/**
 * @route DELETE /api/v1/subscription/coupons/:id
 * @desc Delete a coupon (soft delete)
 * @access Private (Super Admin)
 */
couponsRouter.delete(
  '/:id',
  requireAuth,
  requireSuperAdmin,
  validate(couponIdParamsSchema, 'params'),
  deleteCoupon
);

/**
 * @route GET /api/v1/subscription/coupons/:id/stats
 * @desc Get coupon usage statistics
 * @access Private (Super Admin)
 */
couponsRouter.get(
  '/:id/stats',
  requireAuth,
  requireSuperAdmin,
  validate(couponIdParamsSchema, 'params'),
  getCouponStats
);

export default couponsRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/coupons',
  description: 'Create a new coupon (Super Admin)',
  requestSchema: createCouponSchema,
  tags: ['coupons', 'admin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/coupons',
  description: 'Get all coupons with pagination (Super Admin)',
  tags: ['coupons', 'admin'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/subscription/coupons/:id',
  description: 'Update a coupon (Super Admin)',
  params: couponIdParamsSchema,
  requestSchema: updateCouponSchema,
  tags: ['coupons', 'admin'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/subscription/coupons/:id',
  description: 'Delete a coupon (Super Admin)',
  params: couponIdParamsSchema,
  tags: ['coupons', 'admin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/coupons/:id/stats',
  description: 'Get coupon usage statistics (Super Admin)',
  params: couponIdParamsSchema,
  tags: ['coupons', 'admin'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/subscription/coupons/validate',
  description: 'Validate/apply a coupon code (Clinic)',
  requestSchema: validateCouponSchema,
  tags: ['coupons', 'clinic'],
});
