// src/main/subscription/services/addon.service.ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { CacheKeys } from '../../../utils/cache.util';
import { HttpError } from '../../../middlewear/errorHandler';
import { CYCLE_DAYS } from '../utils/billingCycle.utils';
import { AddOnModel, PlanAddOnLimitsModel } from '../models/addon.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { FEATURE_KEYS, STAFF_USER_TYPES } from './limitation.service';
import { PlansService } from './core/plans.service';

export class AddOnService {
  /**
   * Get all active add-ons (for purchase)
   */
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

  /**
   * Set or update a plan-wise add-on limit configuration
   */
  static async setPlanAddOnLimit(
    planId: string,
    addOnId: string,
    payload: { maxCap?: number | null }
  ) {
    const version = await PlansService.editableVersion(planId);
    const existing = await database
      .select()
      .from(PlanAddOnLimitsModel)
      .where(
        and(
          eq(PlanAddOnLimitsModel.planVersionId, version.id),
          eq(PlanAddOnLimitsModel.addOnId, addOnId)
        )
      )
      .limit(1)
      .then((res) => res[0]);

    if (existing) {
      const [updated] = await database
        .update(PlanAddOnLimitsModel)
        .set({
          ...(payload.maxCap !== undefined && { maxCap: payload.maxCap }),
          updatedAt: new Date(),
        })
        .where(eq(PlanAddOnLimitsModel.id, existing.id))
        .returning();

      await redisClient.del(
        CacheKeys.planAddOnLimits(planId),
        CacheKeys.allPlans
      );
      return updated;
    }

    const [created] = await database
      .insert(PlanAddOnLimitsModel)
      .values({
        planId,
        planVersionId: version.id,
        addOnId,
        maxCap: payload.maxCap ?? null,
      })
      .returning();

    await redisClient.del(
      CacheKeys.planAddOnLimits(planId),
      CacheKeys.allPlans
    );
    return created;
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
    billingCycle: 'monthly' | 'yearly',
    quantity: number = 1,
    fullYearlyPrice?: number
  ): { proRatedPrice: number; remainingDays: number; totalDays: number } {
    const now = new Date();
    const expiresAt = new Date(subscriptionExpiresAt);
    const remainingMs = expiresAt.getTime() - now.getTime();
    const remainingDays = Math.max(
      1,
      Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
    );

    const totalDays = CYCLE_DAYS[billingCycle];
    const fullPrice =
      billingCycle === 'yearly'
        ? (fullYearlyPrice ?? fullMonthlyPrice * 12) * quantity
        : fullMonthlyPrice * quantity;

    const dailyRate = fullPrice / totalDays;
    const proRatedPrice = Math.round(dailyRate * remainingDays * 100) / 100;

    return { proRatedPrice, remainingDays, totalDays };
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
}
