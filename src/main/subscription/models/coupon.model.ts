// src/main/subscription/models/coupon.model.ts
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';

// ==================== ENUMS ====================

export const discountTypeEnum = pgEnum('discount_type', [
  'percentage',
  'fixed',
  'trial',
]);

export const couponStatusEnum = pgEnum('coupon_status', [
  'active',
  'inactive',
  'expired',
]);

export const appliesToEnum = pgEnum('applies_to', [
  'all',
  'plans',
  'addons',
  'specific_plans',
  'specific_addons',
]);

// ==================== COUPON TABLE ====================

export const CouponModel = pgTable(
  'coupons',
  {
    id: serial('id').primaryKey(),

    code: varchar('code', { length: 50 }).notNull().unique(),
    description: text('description'),

    // Discount Configuration
    discountType: discountTypeEnum('discount_type').notNull(),
    discountValue: decimal('discount_value', {
      precision: 10,
      scale: 2,
    }).notNull(),
    maxDiscountAmount: decimal('max_discount_amount', {
      precision: 10,
      scale: 2,
    }),

    // Trial specific (only for discount_type = 'trial')
    trialDays: integer('trial_days'),

    // Applicability
    appliesTo: appliesToEnum('applies_to').notNull().default('all'),
    applicablePlanIds: jsonb('applicable_plan_ids').$type<string[]>(),
    applicableAddOnIds: jsonb('applicable_addon_ids').$type<string[]>(),

    // Usage Limits
    maxUses: integer('max_uses'),
    maxUsesPerClinic: integer('max_uses_per_clinic').default(1),
    minOrderValue: decimal('min_order_value', { precision: 10, scale: 2 }),
    firstTimeOnly: boolean('first_time_only').notNull().default(false),

    // Validity Period
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Status
    status: couponStatusEnum('status').notNull().default('active'),

    // Usage Tracking
    currentUses: integer('current_uses').notNull().default(0),

    // Metadata
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('coupons_code_idx').on(table.code),
    index('coupons_status_idx').on(table.status),
  ]
);

// ==================== TYPES ====================

export type Coupon = typeof CouponModel.$inferSelect;
export type NewCoupon = typeof CouponModel.$inferInsert;

// ==================== ZOD SCHEMAS ====================

export const insertCouponSchema = z.object({
  code: z.string().min(1).max(50),
  description: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed', 'trial']),
  discountValue: z.union([z.string(), z.number()]),
  maxDiscountAmount: z.union([z.string(), z.number()]).optional(),
  trialDays: z.number().int().optional(),
  appliesTo: z
    .enum(['all', 'plans', 'addons', 'specific_plans', 'specific_addons'])
    .default('all'),
  applicablePlanIds: z.array(z.string()).optional(),
  applicableAddOnIds: z.array(z.string()).optional(),
  maxUses: z.number().int().optional(),
  maxUsesPerClinic: z.number().int().default(1),
  minOrderValue: z.union([z.string(), z.number()]).optional(),
  firstTimeOnly: z.boolean().default(false),
  startsAt: z.date(),
  expiresAt: z.date(),
  status: z.enum(['active', 'inactive', 'expired']).default('active'),
  currentUses: z.number().int().default(0),
  createdBy: z.string(),
});

export const selectCouponSchema = z.object({
  id: z.number(),
  code: z.string(),
  description: z.string().nullable(),
  discountType: z.enum(['percentage', 'fixed', 'trial']),
  discountValue: z.union([z.string(), z.number()]),
  maxDiscountAmount: z.union([z.string(), z.number()]).nullable(),
  trialDays: z.number().int().nullable(),
  appliesTo: z.enum([
    'all',
    'plans',
    'addons',
    'specific_plans',
    'specific_addons',
  ]),
  applicablePlanIds: z.array(z.string()).nullable(),
  applicableAddOnIds: z.array(z.string()).nullable(),
  maxUses: z.number().int().nullable(),
  maxUsesPerClinic: z.number().int(),
  minOrderValue: z.union([z.string(), z.number()]).nullable(),
  firstTimeOnly: z.boolean(),
  startsAt: z.date(),
  expiresAt: z.date(),
  status: z.enum(['active', 'inactive', 'expired']),
  currentUses: z.number().int(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ==================== API VALIDATION SCHEMAS ====================

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

export const validateCouponSchema = z.object({
  code: z.string().min(1),
  planId: z.string().optional(),
  addOnId: z.string().optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  orderValue: z.number().min(0),
});
