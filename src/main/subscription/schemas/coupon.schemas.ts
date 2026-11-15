// src/main/subscription/schemas/coupon.schemas.ts
import { z } from 'zod';

// ==================== ADMIN SCHEMAS ====================

const couponFields = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(
      /^[A-Z0-9_-]+$/,
      'Code must be uppercase letters, numbers, hyphens, underscores'
    ),
  description: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.number().positive('Enter a discount greater than 0.'),
  maxDiscountAmount: z.number().min(0).optional(),
  // An empty list under plans / addons means all of them.
  appliesTo: z.enum(['all', 'plans', 'addons']),
  applicablePlanIds: z.array(z.string()).optional(),
  applicableAddOnIds: z.array(z.string()).optional(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerClinic: z.number().int().min(1).default(1),
  minOrderValue: z.number().min(0).optional(),
  firstTimeOnly: z.boolean().default(false),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

const percentUpTo100 = (
  data: { discountType?: string; discountValue?: number },
  ctx: z.RefinementCtx
) => {
  if (data.discountType === 'percentage' && (data.discountValue ?? 0) > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'Enter a percentage from 1 to 100.',
    });
  }
};

export const createCouponSchema = couponFields.superRefine(percentUpTo100);

export const updateCouponSchema = couponFields
  .partial()
  .superRefine(percentUpTo100);

export const couponIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID must be a number'),
});

// ==================== CLINIC SCHEMAS ====================

export const validateCouponSchema = z.object({
  code: z.string().min(1, 'Coupon code is required'),
  planId: z.string().optional(),
  addOnId: z.string().optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  orderValue: z.number().min(0, 'Order value must be non-negative'),
});

// ==================== QUERY SCHEMAS ====================

export const getCouponsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default('1'),
  limit: z.string().regex(/^\d+$/).optional().default('50'),
  status: z.enum(['active', 'inactive', 'expired']).optional(),
});
