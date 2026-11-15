// src/main/subscription/services/coupon.service.ts

import { and, count, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { fromPaise, toPaise } from '../../money';
import type { Coupon, NewCoupon } from '../models/coupon.model';
import { CouponModel } from '../models/coupon.model';
import { SubscriptionPaymentModel } from '../models/subscriptionPayment.model';
import {
  couponDiscountPaise,
  eligibleLines,
  type CouponLine,
} from '../utils/coupon.utils';

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

// Cache constants
const COUPON_CACHE_PREFIX = 'coupon:';
const CACHE_TTL = 300; // 5 minutes
// Another clinic's unpaid checkout holds a use this long, so two checkouts can't both take the last one.
const HOLD_MS = 30 * 60 * 1000;
const P = SubscriptionPaymentModel;

export class CouponService {
  private getCouponCacheKey(code: string): string {
    return `${COUPON_CACHE_PREFIX}${code.toUpperCase()}`;
  }

  private async clearCouponCache(code: string): Promise<void> {
    try {
      await redisClient.del(this.getCouponCacheKey(code));
    } catch (error) {
      logger.error('Failed to clear coupon cache', { code, error });
    }
  }

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

      // "Expired" is read from the end date; it is not a stored status.
      const whereClause =
        status === 'expired'
          ? lt(CouponModel.expiresAt, new Date())
          : status
            ? eq(CouponModel.status, status)
            : undefined;

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

  /** Checked fresh every time (no cached answer); uses are counted from payments. */
  async validateCoupon(params: {
    code: string;
    clinicId: string;
    orderValue: number;
    planId?: string;
    addOnId?: string;
    billingCycle?: 'monthly' | 'yearly';
    /** Every line of a cart, so the scope is judged per line, not on the first add-on only. */
    lines?: CouponLine[];
  }): Promise<CouponValidationResult> {
    const { code, clinicId, orderValue, planId, addOnId } = params;
    const refuse = (
      message: string,
      reason: string
    ): CouponValidationResult => ({
      valid: false,
      discountAmount: 0,
      finalAmount: orderValue,
      message,
      code: reason,
    });

    try {
      const found = await this.getCouponByCode(code.toUpperCase());
      if (!found.success || !found.data) {
        return refuse(
          found.error || 'Invalid coupon code',
          found.code || 'NOT_FOUND'
        );
      }
      const coupon = found.data;
      if (coupon.status !== 'active' || coupon.discountType === 'trial') {
        return refuse('This coupon is not active.', 'INACTIVE');
      }
      const now = new Date();
      if (now < new Date(coupon.startsAt)) {
        return refuse('This coupon is not valid yet.', 'NOT_STARTED');
      }
      if (now > new Date(coupon.expiresAt)) {
        return refuse('This coupon has expired.', 'EXPIRED');
      }

      const orderPaise = toPaise(orderValue);
      const line: CouponLine = {
        kind: planId ? 'plan' : 'addon',
        planId,
        addOnId,
        amountPaise: orderPaise,
      };
      const eligiblePaise = eligibleLines(
        coupon,
        params.lines ?? [line]
      ).reduce((sum, l) => sum + l.amountPaise, 0);
      if (eligiblePaise === 0) {
        return refuse(
          planId
            ? 'This coupon cannot be used on this plan.'
            : 'This coupon cannot be used on this add-on.',
          'NOT_APPLICABLE'
        );
      }
      if (
        coupon.minOrderValue &&
        eligiblePaise < toPaise(coupon.minOrderValue)
      ) {
        return refuse(
          `This coupon needs an order of at least ₹${Number(coupon.minOrderValue)}.`,
          'MIN_ORDER_NOT_MET'
        );
      }

      const uses = await this.countUses(coupon.id, clinicId);
      if (coupon.maxUses !== null && uses.total >= coupon.maxUses) {
        return refuse(
          'This coupon has been fully used.',
          'GLOBAL_LIMIT_REACHED'
        );
      }
      if (uses.byClinic >= (coupon.maxUsesPerClinic ?? 1)) {
        return refuse(
          'You have already used this coupon.',
          'CLINIC_LIMIT_REACHED'
        );
      }
      if (coupon.firstTimeOnly && (await this.hasPaidBefore(clinicId))) {
        return refuse(
          'This coupon is only for clinics buying their first paid plan.',
          'NOT_FIRST_TIME'
        );
      }

      const discountPaise = couponDiscountPaise(coupon, eligiblePaise);
      return {
        valid: true,
        coupon,
        discountAmount: Number(fromPaise(discountPaise)),
        finalAmount: Number(fromPaise(orderPaise - discountPaise)),
      };
    } catch (error) {
      logger.error('Failed to validate coupon', { error, params });
      return refuse(
        'The coupon could not be checked. Please try again.',
        'VALIDATION_ERROR'
      );
    }
  }

  /** Applied payments, plus other clinics' checkouts still inside the hold. */
  private async countUses(couponId: number, clinicId: string) {
    const holdSince = new Date(Date.now() - HOLD_MS);
    const applied = sql`${P.status} = 'captured' and not ${P.needsRefund}`;
    const [row] = await database
      .select({
        total: sql<number>`count(*) filter (where (${applied}) or (${P.status} in ('created', 'pending') and ${P.createdAt} > ${holdSince} and ${P.ownerId} <> ${clinicId}))`,
        byClinic: sql<number>`count(*) filter (where (${applied}) and ${P.ownerId} = ${clinicId})`,
      })
      .from(P)
      .where(eq(P.couponId, couponId));
    return {
      total: Number(row?.total ?? 0),
      byClinic: Number(row?.byClinic ?? 0),
    };
  }

  /** First-time means no earlier captured payment above ₹0. */
  private async hasPaidBefore(clinicId: string): Promise<boolean> {
    const [row] = await database
      .select({ id: P.id })
      .from(P)
      .where(
        and(
          eq(P.ownerType, 'clinic'),
          eq(P.ownerId, clinicId),
          eq(P.status, 'captured'),
          gt(P.amountPaise, 0)
        )
      )
      .limit(1);
    return !!row;
  }

  /** Counted from applied payments; carried-over history is already in subscription_payments. */
  async getCouponStats(couponId: number): Promise<
    ServiceResponse<{
      totalUses: number;
      totalDiscountAmount: number;
      uniqueClinics: number;
    }>
  > {
    try {
      const [row] = await database
        .select({
          uses: count(),
          discountPaise: sql<number>`coalesce(sum(${P.discountPaise}), 0)`,
          clinics: sql<number>`count(distinct ${P.ownerId})`,
        })
        .from(P)
        .where(
          and(
            eq(P.couponId, couponId),
            eq(P.status, 'captured'),
            eq(P.needsRefund, false)
          )
        );

      return {
        success: true,
        data: {
          totalUses: Number(row?.uses) || 0,
          totalDiscountAmount: Number(
            fromPaise(Number(row?.discountPaise) || 0)
          ),
          uniqueClinics: Number(row?.clinics) || 0,
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
}

export const couponService = new CouponService();
