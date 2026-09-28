// src/main/subscription/services/coupon.service.ts

import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import type { Coupon, NewCoupon } from '../models/coupon.model';
import { CouponModel } from '../models/coupon.model';
import type { CouponUsage } from '../models/couponUsage.model';
import { CouponUsageModel } from '../models/couponUsage.model';
import { ClinicSubscriptionModel } from '../models/subscription.model';

// ==================== TYPES & INTERFACES ====================

export interface ServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: Coupon;
  discountAmount: number;
  finalAmount: number;
  message?: string;
  code?: string;
}

export interface DiscountCalculation {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  couponCode?: string;
}

// Cache constants
const COUPON_CACHE_PREFIX = 'coupon:';
const COUPON_VALIDATION_CACHE_PREFIX = 'coupon_validation:';
const CACHE_TTL = 300; // 5 minutes
const VALIDATION_CACHE_TTL = 60; // 1 minute

// ==================== COUPON SERVICE ====================

export class CouponService {
  // ==================== CACHE HELPERS ====================

  private getCouponCacheKey(code: string): string {
    return `${COUPON_CACHE_PREFIX}${code.toUpperCase()}`;
  }

  private getValidationCacheKey(code: string, clinicId: string): string {
    return `${COUPON_VALIDATION_CACHE_PREFIX}${code.toUpperCase()}:${clinicId}`;
  }

  private async clearCouponCache(code: string): Promise<void> {
    try {
      await redisClient.del(this.getCouponCacheKey(code));
    } catch (error) {
      logger.error('Failed to clear coupon cache', { code, error });
    }
  }

  private parseNumeric(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    return parseFloat(value) || 0;
  }

  // ==================== CRUD OPERATIONS ====================

  /**
   * Create a new coupon (Super Admin only)
   */
  async createCoupon(
    couponData: NewCoupon,
    createdBy: string
  ): Promise<ServiceResponse<Coupon>> {
    try {
      const normalizedCode = couponData.code!.toUpperCase();

      // Check for duplicate code
      const existing = await database
        .select()
        .from(CouponModel)
        .where(eq(CouponModel.code, normalizedCode))
        .limit(1);

      if (existing.length > 0) {
        return {
          success: false,
          error: 'Coupon code already exists',
          code: 'DUPLICATE_CODE',
        };
      }

      // Validate discount type specific fields
      if (couponData.discountType === 'trial') {
        if (!couponData.trialDays || couponData.trialDays < 1) {
          return {
            success: false,
            error: 'Trial coupons require trialDays >= 1',
            code: 'INVALID_TRIAL_DAYS',
          };
        }
      }

      // Validate specific applicability
      if (
        couponData.appliesTo === 'specific_plans' &&
        (!couponData.applicablePlanIds ||
          couponData.applicablePlanIds.length === 0)
      ) {
        return {
          success: false,
          error: 'Specific plans coupon requires applicablePlanIds',
          code: 'MISSING_PLAN_IDS',
        };
      }

      if (
        couponData.appliesTo === 'specific_addons' &&
        (!couponData.applicableAddOnIds ||
          couponData.applicableAddOnIds.length === 0)
      ) {
        return {
          success: false,
          error: 'Specific addons coupon requires applicableAddOnIds',
          code: 'MISSING_ADDON_IDS',
        };
      }

      const [coupon] = await database
        .insert(CouponModel)
        .values({
          ...couponData,
          code: normalizedCode,
          createdBy,
        })
        .returning();

      return {
        success: true,
        data: coupon,
      };
    } catch (error) {
      logger.error('Failed to create coupon', { error, couponData });
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create coupon';
      return {
        success: false,
        error: errorMessage,
        code: 'CREATE_FAILED',
      };
    }
  }

  /**
   * Get coupon by ID
   */
  async getCouponById(id: number): Promise<ServiceResponse<Coupon>> {
    try {
      const [coupon] = await database
        .select()
        .from(CouponModel)
        .where(eq(CouponModel.id, id))
        .limit(1);

      if (!coupon) {
        return {
          success: false,
          error: 'Coupon not found',
          code: 'NOT_FOUND',
        };
      }

      return {
        success: true,
        data: coupon,
      };
    } catch (error) {
      logger.error('Failed to get coupon', { error, id });
      return {
        success: false,
        error: 'Failed to get coupon',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Get coupon by code (with Redis caching)
   */
  async getCouponByCode(code: string): Promise<ServiceResponse<Coupon>> {
    const normalizedCode = code.toUpperCase();
    const cacheKey = this.getCouponCacheKey(normalizedCode);

    try {
      // Try cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return {
          success: true,
          data: JSON.parse(cached),
        };
      }

      // Fetch from DB
      const [coupon] = await database
        .select()
        .from(CouponModel)
        .where(eq(CouponModel.code, normalizedCode))
        .limit(1);

      if (!coupon) {
        return {
          success: false,
          error: 'Coupon not found',
          code: 'NOT_FOUND',
        };
      }

      // Cache result
      await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(coupon));

      return {
        success: true,
        data: coupon,
      };
    } catch (error) {
      logger.error('Failed to get coupon by code', { error, code });
      return {
        success: false,
        error: 'Failed to get coupon',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Get all coupons with pagination
   */
  async getAllCoupons(
    page: number = 1,
    limit: number = 50,
    status?: 'active' | 'inactive' | 'expired'
  ): Promise<
    ServiceResponse<{
      coupons: Coupon[];
      total: number;
      page: number;
      totalPages: number;
    }>
  > {
    try {
      const offset = (page - 1) * limit;

      let whereClause;
      if (status) {
        whereClause = eq(CouponModel.status, status);
      }

      const [couponList, totalCount] = await Promise.all([
        database
          .select()
          .from(CouponModel)
          .where(whereClause)
          .orderBy(desc(CouponModel.createdAt))
          .limit(limit)
          .offset(offset),
        database
          .select({ count: count() })
          .from(CouponModel)
          .where(whereClause || sql`1=1`),
      ]);

      return {
        success: true,
        data: {
          coupons: couponList,
          total: Number(totalCount[0]?.count) || 0,
          page,
          totalPages: Math.ceil(Number(totalCount[0]?.count) / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get coupons', { error });
      return {
        success: false,
        error: 'Failed to get coupons',
        code: 'FETCH_FAILED',
      };
    }
  }

  /**
   * Update coupon
   */
  async updateCoupon(
    id: number,
    updateData: Partial<NewCoupon>
  ): Promise<ServiceResponse<Coupon>> {
    try {
      // If code is being updated, check for duplicates
      if (updateData.code) {
        const normalizedCode = updateData.code.toUpperCase();
        const existing = await database
          .select()
          .from(CouponModel)
          .where(
            and(
              eq(CouponModel.code, normalizedCode),
              sql`${CouponModel.id} != ${id}`
            )
          )
          .limit(1);

        if (existing.length > 0) {
          return {
            success: false,
            error: 'Coupon code already exists',
            code: 'DUPLICATE_CODE',
          };
        }
        updateData.code = normalizedCode;
      }

      const [updated] = await database
        .update(CouponModel)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(CouponModel.id, id))
        .returning();

      if (!updated) {
        return {
          success: false,
          error: 'Coupon not found',
          code: 'NOT_FOUND',
        };
      }

      // Clear cache
      await this.clearCouponCache(updated.code);

      return {
        success: true,
        data: updated,
      };
    } catch (error) {
      logger.error('Failed to update coupon', { error, id });
      return {
        success: false,
        error: 'Failed to update coupon',
        code: 'UPDATE_FAILED',
      };
    }
  }

  /**
   * Delete coupon (soft delete by marking inactive)
   */
  async deleteCoupon(id: number): Promise<ServiceResponse<void>> {
    try {
      const [coupon] = await database
        .select()
        .from(CouponModel)
        .where(eq(CouponModel.id, id))
        .limit(1);

      if (!coupon) {
        return {
          success: false,
          error: 'Coupon not found',
          code: 'NOT_FOUND',
        };
      }

      await database
        .update(CouponModel)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(CouponModel.id, id));

      // Clear cache
      await this.clearCouponCache(coupon.code);

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to delete coupon', { error, id });
      return {
        success: false,
        error: 'Failed to delete coupon',
        code: 'DELETE_FAILED',
      };
    }
  }

  // ==================== VALIDATION & DISCOUNT CALCULATION ====================

  /**
   * Calculate discount amount based on coupon type
   */
  private calculateDiscount(
    coupon: Coupon,
    orderValue: number
  ): { discountAmount: number; finalAmount: number } {
    const orderValueNum = parseFloat(orderValue.toString());

    switch (coupon.discountType) {
      case 'fixed': {
        const discount = Math.min(
          this.parseNumeric(coupon.discountValue),
          orderValueNum
        );
        return {
          discountAmount: discount,
          finalAmount: orderValueNum - discount,
        };
      }

      case 'percentage': {
        const percentage = this.parseNumeric(coupon.discountValue);
        let discount = (orderValueNum * percentage) / 100;

        // Apply max discount cap if set
        if (coupon.maxDiscountAmount) {
          discount = Math.min(
            discount,
            this.parseNumeric(coupon.maxDiscountAmount)
          );
        }

        discount = Math.min(discount, orderValueNum);

        return {
          discountAmount: discount,
          finalAmount: orderValueNum - discount,
        };
      }

      case 'trial': {
        // Trial is 100% discount for X days
        return {
          discountAmount: orderValueNum,
          finalAmount: 0,
        };
      }

      default:
        return {
          discountAmount: 0,
          finalAmount: orderValueNum,
        };
    }
  }

  /**
   * Validate if coupon is applicable to this purchase
   */
  private validateApplicability(
    coupon: Coupon,
    params: {
      planId?: string;
      addOnId?: string;
      billingCycle?: string;
    }
  ): { valid: boolean; message?: string } {
    // Check appliesTo rules
    switch (coupon.appliesTo) {
      case 'plans':
        if (params.addOnId && !params.planId) {
          return { valid: false, message: 'Coupon not valid for add-ons' };
        }
        break;

      case 'addons':
        if (params.planId && !params.addOnId) {
          return { valid: false, message: 'Coupon not valid for plans' };
        }
        break;

      case 'specific_plans':
        if (!params.planId) {
          return {
            valid: false,
            message: 'Coupon only valid for specific plans',
          };
        }
        if (!coupon.applicablePlanIds?.includes(params.planId)) {
          return { valid: false, message: 'Coupon not valid for this plan' };
        }
        break;

      case 'specific_addons':
        if (!params.addOnId) {
          return {
            valid: false,
            message: 'Coupon only valid for specific add-ons',
          };
        }
        if (!coupon.applicableAddOnIds?.includes(params.addOnId)) {
          return { valid: false, message: 'Coupon not valid for this add-on' };
        }
        break;

      case 'all':
      default:
        // Valid for everything
        break;
    }

    return { valid: true };
  }

  /**
   * Check if clinic has reached usage limit for a coupon
   */
  private async checkClinicUsageLimit(
    couponId: number,
    clinicId: string,
    maxUsesPerClinic: number
  ): Promise<{ allowed: boolean; currentUses: number }> {
    const usageCount = await database
      .select({ count: count() })
      .from(CouponUsageModel)
      .where(
        and(
          eq(CouponUsageModel.couponId, couponId),
          eq(CouponUsageModel.clinicId, clinicId)
        )
      );

    const currentUses = Number(usageCount[0]?.count) || 0;

    return {
      allowed: currentUses < maxUsesPerClinic,
      currentUses,
    };
  }

  /**
   * Check if clinic is a first-time subscriber (never had a paid subscription)
   */
  private async isFirstTimeSubscriber(clinicId: string): Promise<boolean> {
    const existingSubs = await database
      .select({ count: count() })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.paymentStatus, 'success'),
          ne(ClinicSubscriptionModel.paymentMode, 'free')
        )
      );

    return Number(existingSubs[0]?.count) === 0;
  }

  /**
   * Main validation method - validates coupon for a specific purchase
   * Performs 10 checks:
   * 1. Cache check
   * 2. Fetch coupon
   * 3. Status check
   * 4. Date validity (startsAt/expiresAt)
   * 5. Global usage limit
   * 6. Per-clinic usage limit
   * 6.5. First-time subscriber check
   * 7. Minimum order value
   * 8. Applicability rules
   * 9. Calculate discount
   */
  async validateCoupon(params: {
    code: string;
    clinicId: string;
    orderValue: number;
    planId?: string;
    addOnId?: string;
    billingCycle?: 'monthly' | 'yearly';
  }): Promise<CouponValidationResult> {
    const { code, clinicId, orderValue, planId, addOnId, billingCycle } =
      params;
    const normalizedCode = code.toUpperCase();

    try {
      // 1. Check cache for recent validation
      const cacheKey = this.getValidationCacheKey(normalizedCode, clinicId);
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.valid && parsed.orderValue === orderValue) {
            return parsed;
          }
        }
      } catch {
        // Redis unavailable, continue without cache
      }

      // 2. Fetch coupon
      const couponResult = await this.getCouponByCode(normalizedCode);
      if (!couponResult.success || !couponResult.data) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: couponResult.error || 'Invalid coupon code',
          code: couponResult.code || 'NOT_FOUND',
        };
      }

      const coupon = couponResult.data;

      // 3. Check status
      if (coupon.status !== 'active') {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'Coupon is not active',
          code: 'INACTIVE',
        };
      }

      // 4. Check date validity
      const now = new Date();
      const startsAt = new Date(coupon.startsAt);
      const expiresAt = new Date(coupon.expiresAt);

      if (now < startsAt) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'Coupon is not yet valid',
          code: 'NOT_STARTED',
        };
      }

      if (now > expiresAt) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'Coupon has expired',
          code: 'EXPIRED',
        };
      }

      // 5. Check global usage limit
      if (coupon.maxUses !== null && coupon.currentUses >= coupon.maxUses) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'Coupon usage limit reached',
          code: 'GLOBAL_LIMIT_REACHED',
        };
      }

      // 6. Check per-clinic usage limit
      const usageCheck = await this.checkClinicUsageLimit(
        coupon.id,
        clinicId,
        coupon.maxUsesPerClinic ?? 1
      );

      if (!usageCheck.allowed) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: 'You have already used this coupon',
          code: 'CLINIC_LIMIT_REACHED',
        };
      }

      // 6.5. Check first-time subscriber restriction
      if (coupon.firstTimeOnly) {
        const isFirstTime = await this.isFirstTimeSubscriber(clinicId);
        if (!isFirstTime) {
          return {
            valid: false,
            discountAmount: 0,
            finalAmount: orderValue,
            message: 'This coupon is only valid for first-time subscribers',
            code: 'NOT_FIRST_TIME',
          };
        }
      }

      // 7. Check minimum order value
      if (coupon.minOrderValue) {
        const minValue = this.parseNumeric(coupon.minOrderValue);
        if (orderValue < minValue) {
          return {
            valid: false,
            discountAmount: 0,
            finalAmount: orderValue,
            message: `Minimum order value of ₹${minValue} required`,
            code: 'MIN_ORDER_NOT_MET',
          };
        }
      }

      // 8. Check applicability
      const applicability = this.validateApplicability(coupon, {
        planId,
        addOnId,
        billingCycle,
      });

      if (!applicability.valid) {
        return {
          valid: false,
          discountAmount: 0,
          finalAmount: orderValue,
          message: applicability.message || 'Coupon not applicable',
          code: 'NOT_APPLICABLE',
        };
      }

      // 9. Calculate discount
      const { discountAmount, finalAmount } = this.calculateDiscount(
        coupon,
        orderValue
      );

      const result: CouponValidationResult = {
        valid: true,
        coupon,
        discountAmount,
        finalAmount,
      };

      // Cache successful validation
      try {
        await redisClient.setex(
          cacheKey,
          VALIDATION_CACHE_TTL,
          JSON.stringify({ ...result, orderValue })
        );
      } catch {
        // Redis unavailable, skip caching
      }

      return result;
    } catch (error) {
      logger.error('Failed to validate coupon', { error, params });
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: orderValue,
        message: 'Failed to validate coupon',
        code: 'VALIDATION_ERROR',
      };
    }
  }

  // ==================== APPLICATION & TRACKING ====================

  /**
   * Apply coupon - call this before creating Razorpay order
   */
  async applyCoupon(params: {
    code: string;
    clinicId: string;
    orderValue: number;
    planId?: string;
    addOnId?: string;
    billingCycle?: 'monthly' | 'yearly';
  }): Promise<
    ServiceResponse<
      DiscountCalculation & { couponId: number; couponCode: string }
    >
  > {
    // Validate first
    const validation = await this.validateCoupon(params);

    if (!validation.valid || !validation.coupon) {
      return {
        success: false,
        error: validation.message || 'Invalid coupon',
        code: validation.code || 'INVALID',
      };
    }

    return {
      success: true,
      data: {
        couponId: validation.coupon.id,
        couponCode: validation.coupon.code,
        originalAmount: params.orderValue,
        discountAmount: validation.discountAmount,
        finalAmount: validation.finalAmount,
      },
    };
  }

  /**
   * Record coupon usage after successful payment
   */
  async recordUsage(params: {
    couponId: number;
    clinicId: string;
    orderValue: number;
    discountAmount: number;
    finalAmount: number;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    planId?: string;
    addOnId?: string;
    billingCycle?: string;
  }): Promise<ServiceResponse<void>> {
    try {
      // Record usage
      await database.insert(CouponUsageModel).values({
        couponId: params.couponId,
        clinicId: params.clinicId,
        planId: params.planId,
        addOnId: params.addOnId,
        orderValue: params.orderValue.toString(),
        discountAmount: params.discountAmount.toString(),
        finalAmount: params.finalAmount.toString(),
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: params.razorpayPaymentId,
        billingCycle: params.billingCycle,
      });

      // Increment global usage counter
      await database
        .update(CouponModel)
        .set({
          currentUses: sql`${CouponModel.currentUses} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(CouponModel.id, params.couponId));

      // Clear validation cache for this clinic
      // Clear validation cache for this clinic
      const couponResult = await this.getCouponById(params.couponId);
      if (couponResult.success && couponResult.data) {
        try {
          const cacheKey = this.getValidationCacheKey(
            couponResult.data.code,
            params.clinicId
          );
          await redisClient.del(cacheKey);
        } catch {
          // Redis unavailable
        }
      }

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to record coupon usage', { error, params });
      return {
        success: false,
        error: 'Failed to record usage',
        code: 'RECORD_FAILED',
      };
    }
  }

  /**
   * Get coupon usage statistics
   */
  async getCouponStats(couponId: number): Promise<
    ServiceResponse<{
      totalUses: number;
      totalDiscountAmount: number;
      uniqueClinics: number;
    }>
  > {
    try {
      const usages = await database
        .select({
          count: count(),
          totalDiscount: sql<number>`COALESCE(SUM(${CouponUsageModel.discountAmount}::numeric), 0)`,
        })
        .from(CouponUsageModel)
        .where(eq(CouponUsageModel.couponId, couponId));

      const uniqueClinics = await database
        .select({
          count: sql<number>`COUNT(DISTINCT ${CouponUsageModel.clinicId})`,
        })
        .from(CouponUsageModel)
        .where(eq(CouponUsageModel.couponId, couponId));

      return {
        success: true,
        data: {
          totalUses: Number(usages[0]?.count) || 0,
          totalDiscountAmount: Number(usages[0]?.totalDiscount) || 0,
          uniqueClinics: Number(uniqueClinics[0]?.count) || 0,
        },
      };
    } catch (error) {
      logger.error('Failed to get coupon stats', { error, couponId });
      return {
        success: false,
        error: 'Failed to get statistics',
        code: 'STATS_FAILED',
      };
    }
  }

  /**
   * Get coupon usage history for a clinic
   */
  async getClinicCouponHistory(
    clinicId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<
    ServiceResponse<{
      usages: CouponUsage[];
      total: number;
      page: number;
      totalPages: number;
    }>
  > {
    try {
      const offset = (page - 1) * limit;

      const [usages, totalCount] = await Promise.all([
        database
          .select()
          .from(CouponUsageModel)
          .where(eq(CouponUsageModel.clinicId, clinicId))
          .orderBy(desc(CouponUsageModel.usedAt))
          .limit(limit)
          .offset(offset),
        database
          .select({ count: count() })
          .from(CouponUsageModel)
          .where(eq(CouponUsageModel.clinicId, clinicId)),
      ]);

      return {
        success: true,
        data: {
          usages,
          total: Number(totalCount[0]?.count) || 0,
          page,
          totalPages: Math.ceil(Number(totalCount[0]?.count) / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get clinic coupon history', { error, clinicId });
      return {
        success: false,
        error: 'Failed to get history',
        code: 'HISTORY_FAILED',
      };
    }
  }
}

// ==================== SINGLETON EXPORT ====================

export const couponService = new CouponService();
