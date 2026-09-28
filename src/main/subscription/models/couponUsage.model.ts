// src/main/subscription/models/couponUsage.model.ts
import {
  decimal,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { CouponModel } from './coupon.model';

// ==================== COUPON USAGE TABLE ====================

/**
 * Coupon Usage Tracking
 *
 * Records each coupon redemption for audit and analytics.
 * Links to both the coupon and the clinic that used it.
 */
export const CouponUsageModel = pgTable(
  'coupon_usage',
  {
    id: serial('id').primaryKey(),

    couponId: integer('coupon_id')
      .references(() => CouponModel.id, { onDelete: 'cascade' })
      .notNull(),

    clinicId: uuid('clinic_id').notNull(),

    // What was purchased
    planId: uuid('plan_id'),
    addOnId: uuid('addon_id'),

    // Transaction Details
    orderValue: decimal('order_value', { precision: 10, scale: 2 }).notNull(),
    discountAmount: decimal('discount_amount', {
      precision: 10,
      scale: 2,
    }).notNull(),
    finalAmount: decimal('final_amount', {
      precision: 10,
      scale: 2,
    }).notNull(),

    // Payment Reference
    razorpayOrderId: varchar('razorpay_order_id', { length: 255 }),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 255 }),

    // Context
    billingCycle: varchar('billing_cycle', { length: 20 }),

    // Metadata
    usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('coupon_usage_coupon_id_idx').on(table.couponId),
    index('coupon_usage_clinic_used_idx').on(table.clinicId, table.usedAt),
  ]
);

// ==================== TYPES ====================

export type CouponUsage = typeof CouponUsageModel.$inferSelect;
export type NewCouponUsage = typeof CouponUsageModel.$inferInsert;

// ==================== ZOD SCHEMAS ====================

export const insertCouponUsageSchema = z.object({
  couponId: z.number().int(),
  clinicId: z.string().uuid(),
  planId: z.string().uuid().optional(),
  addOnId: z.string().uuid().optional(),
  orderValue: z.union([z.string(), z.number()]),
  discountAmount: z.union([z.string(), z.number()]),
  finalAmount: z.union([z.string(), z.number()]),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  billingCycle: z.string().optional(),
  usedAt: z.date().optional(),
});

export const selectCouponUsageSchema = z.object({
  id: z.number(),
  couponId: z.number().int(),
  clinicId: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  addOnId: z.string().uuid().nullable(),
  orderValue: z.union([z.string(), z.number()]),
  discountAmount: z.union([z.string(), z.number()]),
  finalAmount: z.union([z.string(), z.number()]),
  razorpayOrderId: z.string().nullable(),
  razorpayPaymentId: z.string().nullable(),
  billingCycle: z.string().nullable(),
  usedAt: z.date(),
});
