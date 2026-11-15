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
