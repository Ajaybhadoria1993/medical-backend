// src/main/subscription/services/addon.service.ts
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { createRazorpayOrder } from '../../../utils/razorpay';
import { encodeAddOnItems } from '../utils/razorpayOrder.utils';
import { CYCLE_DAYS, planPriceForCycle } from '../utils/billingCycle.utils';
import { AddOn, AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { CreateAddOnDto, UpdateAddOnDto } from '../schemas/addon.schemas';
import { SubscriptionActivityService } from './subscriptionActivity.service';
import {
  FeatureKey,
  FEATURE_KEYS,
  LimitationService,
  STAFF_USER_TYPES,
} from './limitation.service';
import logger from '../../../utils/logger';

// Pricing constants
export const ADD_ON_PRICING = {
  additional_doctor: { monthly: 499, yearly: 4790 }, // 20% yearly discount
  additional_staff: { monthly: 99, yearly: 950 },
  additional_storage: { monthly: 199, yearly: 1910 },
  additional_branch: { monthly: 999, yearly: 9590 },
} as const;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Matches the date rendering used by the rest of the activity log. */
function activityDate(value: Date | string | null | undefined): string {
  if (!value) return 'the end of the period';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'the end of the period';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getAddOnPrice(
  featureKey: string,
  billingCycle: 'monthly' | 'yearly'
): number {
  const pricing = ADD_ON_PRICING[featureKey as keyof typeof ADD_ON_PRICING];
  if (!pricing) return 0;
  return billingCycle === 'monthly' ? pricing.monthly : pricing.yearly;
}

export class AddOnService {
  // ==================== Admin Methods ====================

  /**
   * Create a new add-on
   */
  static async createAddOn(payload: CreateAddOnDto) {
    const [addOn] = await database
      .insert(AddOnModel)
      .values({
        name: payload.name,
        description: payload.description,
        featureKey: payload.featureKey,
        unitValue: payload.unitValue ?? 1,
        monthlyPrice: String(payload.monthlyPrice),
        yearlyPrice: String(payload.yearlyPrice),
        currency: payload.currency ?? 'INR',
        isActive: payload.isActive ?? true,
      })
      .returning();

    if (!addOn) {
      throw new HttpError(500, 'Failed to create add-on');
    }

    return addOn;
  }

  /**
   * Update an existing add-on
   */
  static async updateAddOn(id: string, payload: UpdateAddOnDto) {
    const [updated] = await database
      .update(AddOnModel)
      .set({
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && {
          description: payload.description,
        }),
        ...(payload.unitValue !== undefined && {
          unitValue: payload.unitValue,
        }),
        ...(payload.monthlyPrice !== undefined && {
          monthlyPrice: String(payload.monthlyPrice),
        }),
        ...(payload.yearlyPrice !== undefined && {
          yearlyPrice: String(payload.yearlyPrice),
        }),
        ...(payload.currency !== undefined && { currency: payload.currency }),
        ...(payload.isActive !== undefined && { isActive: payload.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(AddOnModel.id, id))
      .returning();

    if (!updated) {
      throw new HttpError(404, 'Add-on not found');
    }

    return updated;
  }

  /**
   * Delete an add-on (soft delete by deactivating)
   */
  static async deleteAddOn(id: string) {
    const [deleted] = await database
      .update(AddOnModel)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(AddOnModel.id, id))
      .returning();

    if (!deleted) {
      throw new HttpError(404, 'Add-on not found');
    }

    // Invalidate any cached add-on data
    await redisClient.del(`addons:all`);
    await redisClient.del(`addons:active`);

    return deleted;
  }

  /**
   * Get all add-ons (admin view)
   */
  static async getAllAddOns() {
    return await database
      .select()
      .from(AddOnModel)
      .orderBy(asc(AddOnModel.monthlyPrice));
  }

  /**
   * Get all active add-ons (for purchase)
   */
  static async getActiveAddOns() {
    return await database
      .select()
      .from(AddOnModel)
      .where(eq(AddOnModel.isActive, true))
      .orderBy(asc(AddOnModel.monthlyPrice));
  }

  // ==================== Clinic Methods ====================

  /**
   * Get available add-ons for a clinic to purchase
   */
  static async getAvailableAddOns() {
    // Try cache first
    const cacheKey = 'addons:active';
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const addOns = await this.getActiveAddOns();

    // Cache for 5 minutes
    await redisClient.setex(cacheKey, 300, JSON.stringify(addOns));

    return addOns;
  }

  /**
   * Get all add-ons purchased by a clinic
   */
  static async getClinicAddOns(clinicId: string) {
    return await database
      .select()
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true)
        )
      );
  }

  /**
   * Get clinic's add-on limits for all purchased add-ons
   */
  static async getClinicAddOnLimits(clinicId: string) {
    const clinicAddOns = await this.getClinicAddOns(clinicId);
    const limits: Record<
      string,
      { total: number; quantity: number; expiresAt: Date | null }
    > = {};

    for (const clinicAddOn of clinicAddOns) {
      const addOn = await database
        .select()
        .from(AddOnModel)
        .where(eq(AddOnModel.id, clinicAddOn.addOnId))
        .limit(1)
        .then((res) => res[0]);

      if (addOn) {
        const existing = limits[addOn.featureKey] || {
          total: 0,
          quantity: 0,
          expiresAt: null,
        };
        limits[addOn.featureKey] = {
          total: existing.total + addOn.unitValue * clinicAddOn.quantity,
          quantity: existing.quantity + clinicAddOn.quantity,
          expiresAt: clinicAddOn.expiresAt,
        };
      }
    }

    return limits;
  }

  // ==================== Purchase Flow ====================

  /**
   * Get the active subscription's expiry date for a clinic.
   * Used to align add-on expiry with the subscription billing cycle.
   */
  private static async getSubscriptionExpiresAt(
    clinicId: string
  ): Promise<Date | null> {
    const [sub] = await database
      .select({ expiresAt: ClinicSubscriptionModel.expiresAt })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1);

    return sub?.expiresAt ?? null;
  }

  /**
   * Calculate pro-rated price for an add-on based on remaining days in the billing cycle.
   * Aligns the add-on billing with the subscription renewal date.
   *
   * Formula: (fullPrice / totalDaysInCycle) * remainingDays
   * Minimum charge: 1 day's worth
   */
  static calculateProRatedPrice(
    fullMonthlyPrice: number,
    subscriptionExpiresAt: Date,
    billingCycle: 'monthly' | 'yearly'
  ): { proRatedPrice: number; remainingDays: number; totalDays: number } {
    const now = new Date();
    const expiresAt = new Date(subscriptionExpiresAt);
    const remainingMs = expiresAt.getTime() - now.getTime();
    const remainingDays = Math.max(
      1,
      Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
    );

    // Cycle length and yearly pricing both come from the shared helpers so the
    // discount rate can't drift from the one used at checkout.
    const totalDays = CYCLE_DAYS[billingCycle];
    const fullPrice = planPriceForCycle(fullMonthlyPrice, billingCycle);

    const dailyRate = fullPrice / totalDays;
    const proRatedPrice = Math.round(dailyRate * remainingDays);

    return { proRatedPrice, remainingDays, totalDays };
  }

  /**
   * Validate maximum cap constraints for purchasing an add-on item.
   * Ensures combined capacity (base plan limit + active add-ons + requested add-on)
   * does not exceed the max cap defined in seed / database model.
   */
  static async validateAddOnMaxCap(
    clinicId: string,
    addOn: AddOn,
    quantity: number
  ) {
    const maxCap = addOn.maxCap ?? null;
    if (maxCap === null || maxCap === undefined) {
      return; // No cap restriction configured for this add-on
    }

    const featureMap: Record<string, string> = {
      additional_doctor: FEATURE_KEYS.DOCTOR_ACCOUNTS,
      additional_staff: FEATURE_KEYS.STAFF_ACCOUNTS,
      additional_storage: FEATURE_KEYS.CLOUD_STORAGE,
    };

    const planFeatureKey = (featureMap[addOn.featureKey] ||
      addOn.featureKey) as FeatureKey;
    const { totalLimit } = await LimitationService.getTotalLimit(
      clinicId,
      planFeatureKey
    );

    const addedUnits = quantity * (addOn.unitValue ?? 1);
    const resultingTotal = totalLimit + addedUnits;

    if (resultingTotal > maxCap) {
      if (addOn.featureKey === 'additional_doctor') {
        throw new HttpError(
          400,
          `Cannot purchase add-on: Total doctor accounts would exceed the maximum limit of ${maxCap} accounts (current limit: ${totalLimit}, requested: +${addedUnits})`
        );
      } else if (addOn.featureKey === 'additional_staff') {
        throw new HttpError(
          400,
          `Cannot purchase add-on: Total staff accounts would exceed the maximum limit of ${maxCap} accounts (current limit: ${totalLimit}, requested: +${addedUnits})`
        );
      } else if (addOn.featureKey === 'additional_storage') {
        const maxCapGB = maxCap / 1024;
        const currentGB = (totalLimit / 1024).toFixed(1);
        const requestedGB = (addedUnits / 1024).toFixed(1);
        throw new HttpError(
          400,
          `Cannot purchase add-on: Total cloud storage would exceed the maximum limit of ${maxCapGB} GB (current limit: ${currentGB} GB, requested: +${requestedGB} GB)`
        );
      } else {
        throw new HttpError(
          400,
          `Cannot purchase add-on: Total capacity for "${addOn.name}" would exceed the maximum allowed limit of ${maxCap}`
        );
      }
    }
  }

  /**
   * Initiate add-on purchase - creates a Razorpay order for one or more add-ons.
   * Price is pro-rated based on remaining days until subscription renewal.
   * Add-on expiry aligns with the subscription expiry date.
   */
  static async quoteAddOnPurchase(
    clinicId: string,
    addOns: {
      addOnId: string;
      billingCycle: 'monthly' | 'yearly';
      quantity: number;
    }[]
  ) {
    // Validate: Clinic must have an active Pro plan to purchase add-ons
    const activeSub = await database
      .select({
        planId: ClinicSubscriptionModel.planId,
        slug: SubscriptionPlanModel.slug,
        expiresAt: ClinicSubscriptionModel.expiresAt,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      )
      .limit(1)
      .then((res) => res[0]);

    if (!activeSub) {
      throw new HttpError(
        403,
        'You must have an active subscription to purchase add-ons'
      );
    }

    const featureCheck = await LimitationService.isFeatureEnabled(
      clinicId,
      FEATURE_KEYS.ADD_ONS
    );
    if (!featureCheck.allowed) {
      throw new HttpError(
        403,
        'Add-ons are not available on your current plan. Please upgrade your plan first.'
      );
    }

    // Check expiry of current subscription
    if (activeSub.expiresAt && new Date(activeSub.expiresAt) < new Date()) {
      throw new HttpError(
        403,
        'Your subscription has expired. Please renew your plan before purchasing add-ons.'
      );
    }

    // Subscription expiry date — add-on will expire on the same date
    const subscriptionExpiresAt = activeSub.expiresAt;

    let totalPrice = 0;
    const addOnDetails: {
      id: string;
      name: string;
      featureKey: string;
      unitValue: number;
      quantity: number;
      billingCycle: string;
      fullPrice: number;
      proRatedPrice: number;
      remainingDays: number;
    }[] = [];

    for (const item of addOns) {
      // Get add-on details
      const [addOn] = await database
        .select()
        .from(AddOnModel)
        .where(eq(AddOnModel.id, item.addOnId))
        .limit(1);

      if (!addOn) {
        throw new HttpError(404, `Add-on not found: ${item.addOnId}`);
      }

      if (!addOn.isActive) {
        throw new HttpError(
          400,
          `Add-on "${addOn.name}" is not available for purchase`
        );
      }

      // Validate maximum cap constraint (Doctor: 9, Staff: 20, Storage: 5 GB)
      await this.validateAddOnMaxCap(clinicId, addOn, item.quantity);

      // Calculate pro-rated price aligned with subscription billing cycle
      const fullUnitPrice = getAddOnPrice(addOn.featureKey, item.billingCycle);

      let itemProRatedPrice: number;
      let remainingDays: number;

      if (subscriptionExpiresAt) {
        const proRata = this.calculateProRatedPrice(
          Number(addOn.monthlyPrice),
          subscriptionExpiresAt,
          item.billingCycle
        );
        itemProRatedPrice = proRata.proRatedPrice * item.quantity;
        remainingDays = proRata.remainingDays;
      } else {
        // No expiry (shouldn't happen for paid plans, but fallback)
        itemProRatedPrice = fullUnitPrice * item.quantity;
        remainingDays = item.billingCycle === 'yearly' ? 365 : 30;
      }

      if (itemProRatedPrice <= 0) {
        throw new HttpError(400, `Invalid pricing for add-on "${addOn.name}"`);
      }

      // Check if clinic already has this add-on active — if expired, deactivate it
      const existingAddOn = await database
        .select()
        .from(ClinicAddOnModel)
        .where(
          and(
            eq(ClinicAddOnModel.clinicId, clinicId),
            eq(ClinicAddOnModel.addOnId, item.addOnId),
            eq(ClinicAddOnModel.isActive, true)
          )
        )
        .limit(1)
        .then((res) => res[0]);

      if (existingAddOn) {
        if (
          existingAddOn.expiresAt &&
          new Date(existingAddOn.expiresAt) < new Date()
        ) {
          await database
            .update(ClinicAddOnModel)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(ClinicAddOnModel.id, existingAddOn.id));
        }
      }

      totalPrice += itemProRatedPrice;
      addOnDetails.push({
        id: addOn.id,
        name: addOn.name,
        featureKey: addOn.featureKey,
        unitValue: addOn.unitValue,
        quantity: item.quantity,
        billingCycle: item.billingCycle,
        fullPrice: fullUnitPrice * item.quantity,
        proRatedPrice: itemProRatedPrice,
        remainingDays,
      });
    }

    return {
      totalPrice,
      currency: 'INR',
      addOns: addOnDetails,
      addOnItemsEncoded: encodeAddOnItems(addOns),
    };
  }

  /**
   * Create the Razorpay order for a previously computed quote.
   * Any coupon discount must be applied here — the amount the customer is
   * actually charged is the order amount, not whatever the response says.
   */
  static async createAddOnOrder(
    clinicId: string,
    quote: Awaited<ReturnType<typeof AddOnService.quoteAddOnPurchase>>,
    coupon?: {
      couponId: number;
      couponCode: string;
      discountAmount: number;
      finalAmount: number;
    }
  ) {
    const chargeAmount = coupon ? coupon.finalAmount : quote.totalPrice;

    const order = await createRazorpayOrder(
      chargeAmount,
      clinicId,
      quote.addOns.map((a) => a.id).join(','),
      'addon-purchase',
      {
        addOnItems: quote.addOnItemsEncoded,
        ...(coupon
          ? {
              couponId: String(coupon.couponId),
              couponCode: coupon.couponCode,
              originalAmount: String(quote.totalPrice),
              discountAmount: String(coupon.discountAmount),
            }
          : {}),
      }
    );

    return {
      orderId: order.id,
      amount: chargeAmount,
      currency: quote.currency,
      addOns: quote.addOns,
    };
  }

  static async initiateAddOnPurchase(
    clinicId: string,
    addOns: {
      addOnId: string;
      billingCycle: 'monthly' | 'yearly';
      quantity: number;
    }[]
  ) {
    const quote = await this.quoteAddOnPurchase(clinicId, addOns);
    return this.createAddOnOrder(clinicId, quote);
  }

  /**
   * Complete purchase after payment (called internally after verification).
   * Add-on expiry is aligned with the subscription expiry date (pro-rated billing).
   */
  static async completePurchase(
    clinicId: string,
    addOns: {
      addOnId: string;
      billingCycle: 'monthly' | 'yearly';
      quantity: number;
    }[],
    transactionId: string,
    orderId: string
  ) {
    // Idempotency: if this payment was already processed (e.g. the frontend
    // verify call ran and then the webhook fired, or vice-versa), do nothing.
    const alreadyProcessed = await database
      .select({ id: ClinicAddOnModel.id })
      .from(ClinicAddOnModel)
      .where(eq(ClinicAddOnModel.transactionId, transactionId))
      .limit(1);

    if (alreadyProcessed.length > 0) {
      return alreadyProcessed.map((row) => ({
        clinicAddOn: row,
        addOnName: '',
        featureKey: '',
        expiresAt: null as Date | null,
      }));
    }

    const purchaseResults = await database.transaction(async (tx) => {
      // Validate Pro plan requirement and get subscription expiry
      const [activeSub] = await tx
        .select({
          slug: SubscriptionPlanModel.slug,
          expiresAt: ClinicSubscriptionModel.expiresAt,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        )
        .limit(1);

      if (!activeSub) {
        throw new HttpError(
          403,
          'You must have an active subscription to purchase add-ons'
        );
      }

      const featureCheck = await LimitationService.isFeatureEnabled(
        clinicId,
        FEATURE_KEYS.ADD_ONS
      );
      if (!featureCheck.allowed) {
        throw new HttpError(
          403,
          'Add-ons are not available on your current plan. Please upgrade your plan first.'
        );
      }

      const results = [];

      for (const item of addOns) {
        // Get add-on details
        const [addOn] = await tx
          .select()
          .from(AddOnModel)
          .where(eq(AddOnModel.id, item.addOnId))
          .limit(1);

        if (!addOn) {
          throw new HttpError(404, `Add-on not found: ${item.addOnId}`);
        }

        // Align expiry with subscription expiry (pro-rated billing)
        const startsAt = new Date();
        let expiresAt: Date;

        if (activeSub.expiresAt) {
          // Align with subscription renewal date
          expiresAt = new Date(activeSub.expiresAt);
        } else {
          // Fallback: standard duration
          expiresAt =
            item.billingCycle === 'yearly'
              ? addDays(startsAt, 365)
              : addDays(startsAt, 30);
        }

        // Calculate pro-rated price
        let totalPrice: number;
        if (activeSub.expiresAt) {
          const proRata = AddOnService.calculateProRatedPrice(
            Number(addOn.monthlyPrice),
            activeSub.expiresAt,
            item.billingCycle
          );
          totalPrice = proRata.proRatedPrice * item.quantity;
        } else {
          const unitPrice = getAddOnPrice(addOn.featureKey, item.billingCycle);
          totalPrice = unitPrice * item.quantity;
        }

        // Create clinic add-on record
        const [clinicAddOn] = await tx
          .insert(ClinicAddOnModel)
          .values({
            clinicId,
            addOnId: item.addOnId,
            quantity: item.quantity,
            billingCycle: item.billingCycle,
            startsAt,
            expiresAt,
            isActive: true,
            provider: 'razorpay',
            providerSubscriptionId: orderId,
            paymentStatus: 'success',
            paymentMode: 'razorpay',
            transactionId,
            price: String(totalPrice),
          })
          .returning();

        results.push({
          clinicAddOn,
          addOnName: addOn.name,
          featureKey: addOn.featureKey,
          expiresAt,
        });
      }

      // Invalidate clinic cache
      await redisClient.del(`clinic_addons:${clinicId}`);
      await redisClient.del(`clinic_limits:${clinicId}`);
      await redisClient.del(`clinic_limits_overview:${clinicId}`);

      return results;
    });

    // One row per add-on rather than one per order: the timeline reads as
    // "what did I buy", and a mixed order shouldn't collapse into one line.
    for (const result of purchaseResults) {
      await SubscriptionActivityService.record({
        clinicId,
        type: 'addon_purchased',
        title: `Add-on purchased: ${result.addOnName}`,
        description: `${result.clinicAddOn?.quantity ?? 1} × ${result.addOnName}, active until ${activityDate(result.expiresAt)}.`,
        amount: result.clinicAddOn?.price ?? null,
        metadata: {
          clinicAddOnId: result.clinicAddOn?.id,
          addOnName: result.addOnName,
          featureKey: result.featureKey,
          quantity: result.clinicAddOn?.quantity,
          billingCycle: result.clinicAddOn?.billingCycle,
          transactionId,
          orderId,
        },
      });
    }

    // If AutoPay is on, update the recurring mandate to include the new add-ons
    // from the next cycle onward (best-effort — never blocks the purchase).
    const { AutoRenewService } = await import('./autoRenew.service');
    await AutoRenewService.syncAutoRenewAmount(clinicId);

    return purchaseResults;
  }

  /**
   * Resolve an add-on's display name for activity-log entries. The log stores
   * the name as it was at the time, so a later rename doesn't rewrite history.
   */
  private static async addOnNameFor(addOnId: string): Promise<string> {
    const [addOn] = await database
      .select({ name: AddOnModel.name })
      .from(AddOnModel)
      .where(eq(AddOnModel.id, addOnId))
      .limit(1);

    return addOn?.name ?? 'Add-on';
  }

  /**
   * Get cancellation / reduction capacity preview and list of eligible users to deactivate
   */
  static async getCancellationPreview(
    clinicAddOnId: string,
    clinicId: string,
    reduceBy?: number
  ) {
    const [row] = await database
      .select({
        clinicAddOnId: ClinicAddOnModel.id,
        addOnId: ClinicAddOnModel.addOnId,
        quantity: ClinicAddOnModel.quantity,
        expiresAt: ClinicAddOnModel.expiresAt,
        name: AddOnModel.name,
        featureKey: AddOnModel.featureKey,
        unitValue: AddOnModel.unitValue,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
      .where(
        and(
          eq(ClinicAddOnModel.id, clinicAddOnId),
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true)
        )
      )
      .limit(1);

    if (!row) {
      throw new HttpError(404, 'Active add-on not found');
    }

    const isDoctor =
      row.featureKey === 'additional_doctor' ||
      row.featureKey === FEATURE_KEYS.DOCTOR_ACCOUNTS;
    const isStaff =
      row.featureKey === 'additional_staff' ||
      row.featureKey === FEATURE_KEYS.STAFF_ACCOUNTS;

    if (!isDoctor && !isStaff) {
      return {
        addOn: {
          id: row.clinicAddOnId,
          name: row.name,
          featureKey: row.featureKey,
          currentQuantity: row.quantity,
          expiresAt: row.expiresAt,
        },
        currentActiveCount: 0,
        currentLimit: 0,
        postRemovalLimit: 0,
        excessCount: 0,
        selectionRequired: false,
        eligibleUsers: [],
      };
    }

    const unitsToRemove = reduceBy
      ? Math.max(1, Math.min(reduceBy, row.quantity))
      : row.quantity;
    const capacityToRemove = unitsToRemove * (row.unitValue || 1);

    let currentActiveCount = 0;
    let currentLimit = 0;
    let eligibleUsers: {
      id: string;
      name: string | null;
      email: string | null;
      userType: string;
      assignedAt: Date;
    }[] = [];

    if (isDoctor) {
      const doctorCheck = await LimitationService.checkDoctorLimit(clinicId);
      currentActiveCount = doctorCheck.currentUsage;
      currentLimit = doctorCheck.limit ?? 0;
      const postRemovalLimit = Math.max(0, currentLimit - capacityToRemove);
      const excessCount = Math.max(0, currentActiveCount - postRemovalLimit);

      if (excessCount > 0) {
        const users = await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            userType: UserModel.userType,
            assignedAt: ClinicAssignModel.createdAt,
          })
          .from(ClinicAssignModel)
          .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              eq(UserModel.isArchive, false),
              eq(UserModel.userStatus, 'Active'),
              eq(UserModel.userType, 'Doctor')
            )
          )
          .orderBy(asc(ClinicAssignModel.createdAt));

        eligibleUsers = users;
      }

      return {
        addOn: {
          id: row.clinicAddOnId,
          name: row.name,
          featureKey: row.featureKey,
          currentQuantity: row.quantity,
          expiresAt: row.expiresAt,
        },
        currentActiveCount,
        currentLimit,
        postRemovalLimit,
        excessCount,
        selectionRequired: excessCount > 0,
        eligibleUsers,
      };
    } else {
      const staffCheck = await LimitationService.checkStaffLimit(clinicId);
      currentActiveCount = staffCheck.currentUsage;
      currentLimit = staffCheck.limit ?? 0;
      const postRemovalLimit = Math.max(0, currentLimit - capacityToRemove);
      const excessCount = Math.max(0, currentActiveCount - postRemovalLimit);

      if (excessCount > 0) {
        const users = await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            userType: UserModel.userType,
            assignedAt: ClinicAssignModel.createdAt,
          })
          .from(ClinicAssignModel)
          .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              eq(UserModel.isArchive, false),
              eq(UserModel.userStatus, 'Active'),
              inArray(UserModel.userType, [...STAFF_USER_TYPES])
            )
          )
          .orderBy(asc(ClinicAssignModel.createdAt));

        eligibleUsers = users;
      }

      return {
        addOn: {
          id: row.clinicAddOnId,
          name: row.name,
          featureKey: row.featureKey,
          currentQuantity: row.quantity,
          expiresAt: row.expiresAt,
        },
        currentActiveCount,
        currentLimit,
        postRemovalLimit,
        excessCount,
        selectionRequired: excessCount > 0,
        eligibleUsers,
      };
    }
  }

  /**
   * Validates user selection for add-on deactivation
   */
  static async validateDeactivateUsers(
    clinicId: string,
    featureKey: string,
    excessCount: number,
    deactivateUserIds: string[]
  ) {
    if (excessCount <= 0) {
      return;
    }

    if (
      !Array.isArray(deactivateUserIds) ||
      deactivateUserIds.length !== excessCount
    ) {
      const roleLabel =
        featureKey === 'additional_doctor' ||
        featureKey === FEATURE_KEYS.DOCTOR_ACCOUNTS
          ? 'doctor(s)'
          : 'staff member(s)';
      throw new HttpError(
        400,
        `Removing this add-on requires selecting exactly ${excessCount} ${roleLabel} to deactivate on expiry, but ${deactivateUserIds?.length ?? 0} was provided.`
      );
    }

    const uniqueIds = Array.from(new Set(deactivateUserIds));
    if (uniqueIds.length !== deactivateUserIds.length) {
      throw new HttpError(
        400,
        'Duplicate user IDs provided in deactivation selection.'
      );
    }

    const users = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        isArchive: UserModel.isArchive,
      })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.id, deactivateUserIds)
        )
      );

    if (users.length !== deactivateUserIds.length) {
      throw new HttpError(
        400,
        'One or more selected users were not found or are not assigned to this clinic.'
      );
    }

    const isDoctor =
      featureKey === 'additional_doctor' ||
      featureKey === FEATURE_KEYS.DOCTOR_ACCOUNTS;

    for (const user of users) {
      if (user.userType === 'Admin') {
        throw new HttpError(
          400,
          'Clinic owner/admin accounts cannot be selected for deactivation.'
        );
      }
      if (user.isArchive || user.userStatus !== 'Active') {
        throw new HttpError(
          400,
          `User '${user.name || user.id}' is already inactive or archived.`
        );
      }
      if (isDoctor && user.userType !== 'Doctor') {
        throw new HttpError(
          400,
          `User '${user.name || user.id}' is not a Doctor account.`
        );
      }
      if (!isDoctor && !STAFF_USER_TYPES.includes(user.userType as any)) {
        throw new HttpError(
          400,
          `User '${user.name || user.id}' is not a valid Staff account.`
        );
      }
    }
  }

  /**
   * Schedule an add-on cancellation at end of its billing period.
   * Add-on stays active until expiresAt, then won't renew.
   * If removing causes active doctor/staff count to exceed post-removal limit,
   * Admin must select which accounts will be deactivated at expiresAt.
   */
  static async scheduleCancelAddOn(
    clinicAddOnId: string,
    clinicId: string,
    reason?: string,
    deactivateUserIds: string[] = []
  ) {
    const preview = await this.getCancellationPreview(clinicAddOnId, clinicId);

    if (preview.selectionRequired) {
      await this.validateDeactivateUsers(
        clinicId,
        preview.addOn.featureKey,
        preview.excessCount,
        deactivateUserIds
      );
    }

    const [updated] = await database
      .update(ClinicAddOnModel)
      .set({
        cancelAtPeriodEnd: true,
        cancelledAt: new Date(),
        cancellationReason: reason || null,
        scheduledDeactivateUserIds: preview.selectionRequired
          ? deactivateUserIds
          : [],
        updatedAt: new Date(),
      })
      .where(eq(ClinicAddOnModel.id, clinicAddOnId))
      .returning();

    const addOnName = await AddOnService.addOnNameFor(preview.addOn.id);
    await SubscriptionActivityService.record({
      clinicId,
      type: 'addon_removal_scheduled',
      title: `Add-on removal scheduled: ${addOnName}`,
      description: `${addOnName} stays available until ${activityDate(updated.expiresAt)}, then will not renew.`,
      metadata: {
        clinicAddOnId,
        addOnName,
        reason: reason || null,
        expiresAt: updated.expiresAt,
        scheduledDeactivateUserIds: updated.scheduledDeactivateUserIds,
      },
    });

    // Invalidate cache
    await redisClient.del(`clinic_addons:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    // Scheduled-for-removal add-ons drop out of the next recurring charge.
    const { AutoRenewService } = await import('./autoRenew.service');
    await AutoRenewService.syncAutoRenewAmount(clinicId);

    return {
      ...updated,
      scheduledDeactivationsCount: updated.scheduledDeactivateUserIds.length,
      note: `Selected accounts remain active until ${activityDate(updated.expiresAt)}, after which they will be archived automatically.`,
    };
  }

  /**
   * Undo a scheduled add-on cancellation (re-enable renewal).
   * Clears scheduled user deactivations.
   */
  static async undoCancelAddOn(clinicAddOnId: string, clinicId: string) {
    const [clinicAddOn] = await database
      .select()
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.id, clinicAddOnId),
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true),
          eq(ClinicAddOnModel.cancelAtPeriodEnd, true)
        )
      )
      .limit(1);

    if (!clinicAddOn) {
      throw new HttpError(404, 'No add-on with pending cancellation found');
    }

    const [updated] = await database
      .update(ClinicAddOnModel)
      .set({
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        cancellationReason: null,
        scheduledDeactivateUserIds: [],
        updatedAt: new Date(),
      })
      .where(eq(ClinicAddOnModel.id, clinicAddOnId))
      .returning();

    const addOnName = await AddOnService.addOnNameFor(clinicAddOn.addOnId);
    await SubscriptionActivityService.record({
      clinicId,
      type: 'addon_removal_undone',
      title: `Add-on removal withdrawn: ${addOnName}`,
      description: `${addOnName} will renew as normal.`,
      metadata: { clinicAddOnId, addOnName },
    });

    // Invalidate cache
    await redisClient.del(`clinic_addons:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    // Add-on is renewing again — restore it in the next recurring charge.
    const { AutoRenewService } = await import('./autoRenew.service');
    await AutoRenewService.syncAutoRenewAmount(clinicId);

    return updated;
  }

  /**
   * Cancel a clinic's add-on subscription (immediate)
   */
  static async cancelAddOn(clinicAddOnId: string, clinicId: string) {
    const [updated] = await database
      .update(ClinicAddOnModel)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicAddOnModel.id, clinicAddOnId),
          eq(ClinicAddOnModel.clinicId, clinicId)
        )
      )
      .returning();

    if (!updated) {
      throw new HttpError(404, 'Clinic add-on not found');
    }

    // Invalidate clinic cache
    await redisClient.del(`clinic_addons:${updated.clinicId}`);
    await redisClient.del(`clinic_limits:${updated.clinicId}`);
    await redisClient.del(`clinic_limits_overview:${updated.clinicId}`);

    const { AutoRenewService } = await import('./autoRenew.service');
    await AutoRenewService.syncAutoRenewAmount(updated.clinicId);

    return updated;
  }

  /**
   * Reduce the quantity of an active add-on.
   * If quantity reaches 0, cancellation is scheduled for period end.
   */
  static async reduceAddOnQuantity(
    clinicAddOnId: string,
    clinicId: string,
    reduceBy: number = 1,
    deactivateUserIds: string[] = []
  ) {
    const [clinicAddOn] = await database
      .select()
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.id, clinicAddOnId),
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true)
        )
      )
      .limit(1);

    if (!clinicAddOn) {
      throw new HttpError(404, 'Active add-on not found');
    }

    if (reduceBy < 1) {
      throw new HttpError(400, 'Reduce amount must be at least 1');
    }

    const newQuantity = clinicAddOn.quantity - reduceBy;

    if (newQuantity <= 0) {
      const scheduledResult = await this.scheduleCancelAddOn(
        clinicAddOnId,
        clinicId,
        'Quantity reduced to zero',
        deactivateUserIds
      );
      return { ...scheduledResult, removed: false, scheduled: true };
    }

    const preview = await this.getCancellationPreview(
      clinicAddOnId,
      clinicId,
      reduceBy
    );

    if (preview.selectionRequired) {
      await this.validateDeactivateUsers(
        clinicId,
        preview.addOn.featureKey,
        preview.excessCount,
        deactivateUserIds
      );
    }

    // Reduce quantity and adjust price proportionally
    const pricePerUnit = Number(clinicAddOn.price) / clinicAddOn.quantity;
    const newPrice = Math.round(pricePerUnit * newQuantity);

    const [updated] = await database
      .update(ClinicAddOnModel)
      .set({
        quantity: newQuantity,
        price: String(newPrice),
        scheduledDeactivateUserIds: preview.selectionRequired
          ? deactivateUserIds
          : clinicAddOn.scheduledDeactivateUserIds,
        updatedAt: new Date(),
      })
      .where(eq(ClinicAddOnModel.id, clinicAddOnId))
      .returning();

    const reducedName = await AddOnService.addOnNameFor(clinicAddOn.addOnId);
    await SubscriptionActivityService.record({
      clinicId,
      type: 'addon_quantity_reduced',
      title: `Add-on reduced: ${reducedName}`,
      description: `Quantity changed from ${clinicAddOn.quantity} to ${newQuantity}.`,
      amount: newPrice,
      metadata: {
        clinicAddOnId,
        addOnName: reducedName,
        previousQuantity: clinicAddOn.quantity,
        newQuantity,
      },
    });

    await redisClient.del(`clinic_addons:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    const { AutoRenewService } = await import('./autoRenew.service');
    await AutoRenewService.syncAutoRenewAmount(clinicId);

    return { ...updated, removed: false, scheduled: false };
  }

  /**
   * Process and deactivate all add-ons that have reached expiresAt.
   * Archives specifically selected doctor/staff accounts and invalidates caches.
   */
  static async processExpiredAddOns(): Promise<{
    processed: number;
    deactivatedCount: number;
    archivedUsersCount: number;
    errors: string[];
  }> {
    const now = new Date();
    const errors: string[] = [];
    let deactivatedCount = 0;
    let archivedUsersCount = 0;

    const expired = await database
      .select({
        id: ClinicAddOnModel.id,
        clinicId: ClinicAddOnModel.clinicId,
        addOnId: ClinicAddOnModel.addOnId,
        scheduledDeactivateUserIds: ClinicAddOnModel.scheduledDeactivateUserIds,
        expiresAt: ClinicAddOnModel.expiresAt,
      })
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.isActive, true),
          isNotNull(ClinicAddOnModel.expiresAt),
          lte(ClinicAddOnModel.expiresAt, now)
        )
      );

    for (const row of expired) {
      try {
        const res = await this.deactivateExpiredAddOn(row);
        deactivatedCount++;
        archivedUsersCount += res.archivedUsers;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Add-on ${row.id} (clinic ${row.clinicId}): ${msg}`);
        logger.error(
          `[AddOnService:processExpiredAddOns] Failed on add-on ${row.id}:`,
          err
        );
      }
    }

    return {
      processed: expired.length,
      deactivatedCount,
      archivedUsersCount,
      errors,
    };
  }

  /**
   * Process expired add-ons for a specific clinic (e.g. called during auto-renew)
   */
  static async processExpiredAddOnsForClinic(clinicId: string): Promise<void> {
    const now = new Date();
    const expired = await database
      .select({
        id: ClinicAddOnModel.id,
        clinicId: ClinicAddOnModel.clinicId,
        addOnId: ClinicAddOnModel.addOnId,
        scheduledDeactivateUserIds: ClinicAddOnModel.scheduledDeactivateUserIds,
        expiresAt: ClinicAddOnModel.expiresAt,
      })
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true),
          isNotNull(ClinicAddOnModel.expiresAt),
          lte(ClinicAddOnModel.expiresAt, now)
        )
      );

    for (const row of expired) {
      await this.deactivateExpiredAddOn(row);
    }
  }

  /**
   * Deactivate a single expired add-on row and archive scheduled users
   */
  private static async deactivateExpiredAddOn(row: {
    id: string;
    clinicId: string;
    addOnId: string;
    scheduledDeactivateUserIds: string[];
    expiresAt: Date | null;
  }): Promise<{ archivedUsers: number }> {
    const now = new Date();

    // 1. Mark add-on as inactive
    await database
      .update(ClinicAddOnModel)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(eq(ClinicAddOnModel.id, row.id));

    let archivedUsers = 0;
    const userIdsToDeactivate = (row.scheduledDeactivateUserIds ?? []).filter(
      (id) => typeof id === 'string' && id.length > 0
    );

    // 2. Archive specifically selected users
    if (userIdsToDeactivate.length > 0) {
      const updated = await database
        .update(UserModel)
        .set({
          isArchive: true,
          userStatus: 'Inactive',
          updatedAt: now,
        })
        .where(
          and(
            inArray(UserModel.id, userIdsToDeactivate),
            eq(UserModel.isArchive, false)
          )
        )
        .returning({ id: UserModel.id });

      archivedUsers = updated.length;

      for (const user of updated) {
        await redisClient.del(`user:${user.id}`);
      }
    }

    // 3. Fallback safety: Check if clinic still exceeds doctor or staff limits
    await LimitationService.enforceStaffLimitsOnExpiry(row.clinicId);

    // 4. Invalidate clinic caches
    await redisClient.del(`clinic_addons:${row.clinicId}`);
    await redisClient.del(`clinic_limits:${row.clinicId}`);
    await redisClient.del(`clinic_limits_overview:${row.clinicId}`);
    await redisClient.del(`clinic_plan:${row.clinicId}`);

    // 5. Activity log
    const addOnName = await AddOnService.addOnNameFor(row.addOnId);
    await SubscriptionActivityService.record({
      clinicId: row.clinicId,
      type: 'addon_expired',
      title: `Add-on expired: ${addOnName}`,
      description: `${addOnName} has expired and was deactivated.${archivedUsers > 0 ? ` ${archivedUsers} account(s) archived.` : ''}`,
      metadata: {
        clinicAddOnId: row.id,
        addOnName,
        archivedUserIds: userIdsToDeactivate,
        archivedCount: archivedUsers,
        expiresAt: row.expiresAt,
      },
    });

    return { archivedUsers };
  }

  // ==================== Limit Calculation Helpers ====================

  /**
   * Calculate total limit for a feature by summing base plan + all active add-ons
   */
  static async calculateTotalLimit(
    clinicId: string,
    featureKey: string
  ): Promise<number> {
    // This method would be called by LimitationService to get add-on contributions
    // Return the sum of unit values from all active add-ons for this feature

    const addOns = await database
      .select({
        unitValue: AddOnModel.unitValue,
        quantity: ClinicAddOnModel.quantity,
        expiresAt: ClinicAddOnModel.expiresAt,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true),
          eq(AddOnModel.featureKey, featureKey)
        )
      );

    const now = new Date();
    let totalAddOnValue = 0;

    for (const addOn of addOns) {
      // Only count if not expired or no expiry
      if (!addOn.expiresAt || new Date(addOn.expiresAt) > now) {
        totalAddOnValue += (addOn.unitValue || 1) * (addOn.quantity || 1);
      }
    }

    return totalAddOnValue;
  }

  /**
   * Recalculate and update expiry date for a clinic's add-on
   * (useful for renewal flows)
   */
  static async recalculateExpiryDate(clinicId: string, addOnId: string) {
    const [clinicAddOn] = await database
      .select()
      .from(ClinicAddOnModel)
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.addOnId, addOnId),
          eq(ClinicAddOnModel.isActive, true)
        )
      )
      .limit(1);

    if (!clinicAddOn) {
      throw new HttpError(404, 'Clinic add-on not found');
    }

    const startsAt = new Date();
    const billingCycle = clinicAddOn.billingCycle as 'monthly' | 'yearly';
    const expiresAt =
      billingCycle === 'yearly'
        ? addDays(startsAt, 365)
        : addDays(startsAt, 30);

    await database
      .update(ClinicAddOnModel)
      .set({
        startsAt,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(ClinicAddOnModel.id, clinicAddOn.id));

    // Invalidate cache
    await redisClient.del(`clinic_addons:${clinicId}`);
    await redisClient.del(`clinic_limits:${clinicId}`);
    await redisClient.del(`clinic_limits_overview:${clinicId}`);

    return { expiresAt };
  }
}
