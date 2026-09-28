// src/main/subscription/schemas/coupon.schemas.ts
import { z } from 'zod';

// ==================== ADMIN SCHEMAS ====================

export const createCouponSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(
      /^[A-Z0-9_-]+$/,
      'Code must be uppercase letters, numbers, hyphens, underscores'
    ),
  description: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed', 'trial']),
  discountValue: z.number().min(0),
  maxDiscountAmount: z.number().min(0).optional(),
  trialDays: z.number().int().min(1).optional(),
  appliesTo: z.enum([
    'all',
    'plans',
    'addons',
    'specific_plans',
    'specific_addons',
  ]),
  applicablePlanIds: z.array(z.string()).optional(),
  applicableAddOnIds: z.array(z.string()).optional(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerClinic: z.number().int().min(1).default(1),
  minOrderValue: z.number().min(0).optional(),
  firstTimeOnly: z.boolean().default(false),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const updateCouponSchema = createCouponSchema.partial();

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
