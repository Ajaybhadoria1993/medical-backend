import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { AppointmentModel } from '../../../appointments/models/appointment.model';
import { doctorGallery, patientGallery } from '../../../appointments/models';
import { ClinicAssignModel } from '../../../clinic/models/clinic.model';
import {
  ReportCardModel,
  ReportsModel,
} from '../../../reports/models/reports.model';
import { UserModel } from '../../../users/models/user.model';
import { AddOnModel } from '../../models/addon.model';
import { ClinicUsageModel } from '../../models/clinicUsage.model';
import { PlanFeaturesModel } from '../../models/planFeatures.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import redisClient from '../../../../configurations/redisConfig';
import { CacheKeys } from '../../../../utils/cache.util';
import logger from '../../../../utils/logger';
import { PlansService } from './plans.service';
import {
  SubscriptionAddOnModel,
  SubscriptionModel,
} from '../../models/ownerSubscription.model';
import { PlanVersionModel } from '../../models/planVersion.model';
import type {
  PlanLimitRow,
  PlanLimitsStats,
  UpgradeOpportunities,
  UsageInsights,
} from '../../types/planLimits.types';
import {
  LIMIT_KEYS,
  addMapValue,
  isDateOutsideRetention,
  mapAddOnFeatureKey,
  percentage,
  toNumber,
} from '../../utils/planLimits.utils';

/** Super Admin plan limits: the limits table, its dashboard numbers, single-limit edits and cache clearing. */
export class PlanLimitsService {
  /** Every plan with its newest version's limits, plus the dashboard numbers. */
  static async overview() {
    const [plans, limits, analytics] = await Promise.all([
      database.select().from(SubscriptionPlanModel),
      PlanLimitsService.readableLimits(),
      PlanLimitsService.dashboardAnalytics(),
    ]);
    // The version these limits belong to: the screen edits it only while no clinic is on it.
    const newest = new Map(
      await Promise.all(
        plans.map(
          async (p) => [p.id, (await PlansService.versionsOf(p.id))[0]] as const
        )
      )
    );
    const data = plans.map((plan) => {
      const v = newest.get(plan.id);
      return {
        planId: plan.id,
        planSlug: plan.slug,
        planName: plan.name,
        version: v
          ? {
              id: v.version.id,
              versionNo: v.version.versionNo,
              clinics: v.clinics,
            }
          : null,
        limits: limits
          .filter((l) => l.planId === plan.id)
          .map((l) => ({
            id: l.id,
            featureKey: l.featureKey,
            limitValue: l.limitValue,
            isUnlimited: l.isUnlimited,
            enabled: l.enabled,
            description: l.description,
          })),
      };
    });
    return { ...analytics, data };
  }

  /** Sets one limit on the plan's editable version; only the fields sent change. */
  static async updateOne(
    planId: string,
    featureKey: string,
    input: {
      limitValue?: number | null;
      isUnlimited?: boolean;
      enabled?: boolean;
      description?: string | null;
    }
  ) {
    const { limitValue, isUnlimited, enabled, description } = input;
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);
    if (!plan) throw new HttpError(404, 'Plan not found');
    const version = await PlansService.editableVersion(planId);
    const [row] = await database
      .insert(PlanFeaturesModel)
      .values({
        planId,
        planVersionId: version.id,
        featureKey,
        limitValue: limitValue ?? null,
        isUnlimited: isUnlimited ?? false,
        enabled: enabled ?? true,
        description: description ?? null,
      })
      .onConflictDoUpdate({
        target: [PlanFeaturesModel.planVersionId, PlanFeaturesModel.featureKey],
        set: {
          ...(limitValue !== undefined && { limitValue }),
          ...(isUnlimited !== undefined && { isUnlimited }),
          ...(enabled !== undefined && { enabled }),
          ...(description !== undefined && { description }),
          updatedAt: new Date(),
        },
      })
      .returning();
    await PlanLimitsService.invalidatePlanCaches(planId);
    return { plan, row };
  }

  /** Limits of each plan's newest version: the version the Super Admin edits. */
  static async readableLimits(): Promise<PlanLimitRow[]> {
    return database
      .select({
        id: PlanFeaturesModel.id,
        planId: PlanFeaturesModel.planId,
        featureKey: PlanFeaturesModel.featureKey,
        limitValue: PlanFeaturesModel.limitValue,
        isUnlimited: PlanFeaturesModel.isUnlimited,
        enabled: PlanFeaturesModel.enabled,
        description: PlanFeaturesModel.description,
      })
      .from(PlanFeaturesModel)
      .where(
        inArray(
          PlanFeaturesModel.planVersionId,
          await PlansService.latestVersionIds()
        )
      );
  }

  /**
   * Builds dashboard analytics for the Super Admin plan limits page.
   *
   * Notes on schema support:
   * - subscription_plans has no active/status column, so totalPlans currently
   *   means all configured plans.
   * - storage is represented as retention months, not consumed bytes. The
   *   storage metric therefore flags clinics with stored files older than their
   *   plan retention window. Exact GB/MB usage would require storing file size
   *   metadata per uploaded asset.
   */
  static async dashboardAnalytics(): Promise<{
    stats: PlanLimitsStats;
    usageInsights: UsageInsights;
    upgradeOpportunities: UpgradeOpportunities;
  }> {
    const now = new Date();
    const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentPeriodEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const [plans, limits, activeSubscriptionRows] = await Promise.all([
      database.select().from(SubscriptionPlanModel),
      PlanLimitsService.readableLimits(),
      // Paying clinics only: a trial or Free brings no revenue. A yearly price counts as 1/12 a month.
      database
        .select({
          clinicId: SubscriptionModel.ownerId,
          planId: PlanVersionModel.planId,
          price: sql<string>`CASE WHEN ${SubscriptionModel.billingCycle} = 'yearly'
            THEN COALESCE(${PlanVersionModel.yearlyPrice}, 0) / 12
            ELSE COALESCE(${PlanVersionModel.monthlyPrice}, 0) END`,
        })
        .from(SubscriptionModel)
        .innerJoin(
          PlanVersionModel,
          eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
        )
        .innerJoin(
          SubscriptionPlanModel,
          eq(SubscriptionPlanModel.id, PlanVersionModel.planId)
        )
        .where(
          and(
            eq(SubscriptionModel.ownerType, 'clinic'),
            inArray(SubscriptionModel.status, ['active', 'past_due']),
            eq(SubscriptionModel.isTrial, false),
            eq(SubscriptionPlanModel.kind, 'paid'),
            gte(SubscriptionModel.currentPeriodEnd, now)
          )
        ),
    ]);

    const activeSubscriptionsByClinic = new Map<
      string,
      (typeof activeSubscriptionRows)[number]
    >();

    for (const subscription of activeSubscriptionRows) {
      if (!activeSubscriptionsByClinic.has(subscription.clinicId)) {
        activeSubscriptionsByClinic.set(subscription.clinicId, subscription);
      }
    }

    const totalSubscribers = activeSubscriptionsByClinic.size;
    const monthlyRecurringRevenue = Array.from(
      activeSubscriptionsByClinic.values()
    ).reduce((sum, subscription) => sum + toNumber(subscription.price), 0);
    const totalFeaturesManaged = new Set(
      limits.map((limit) => limit.featureKey)
    ).size;

    const stats = {
      totalPlans: plans.length,
      totalSubscribers,
      monthlyRecurringRevenue,
      totalFeaturesManaged,
    };

    if (totalSubscribers === 0) {
      return {
        stats,
        usageInsights: {
          whatsappUsageReachedLimit: 0,
          doctorAccountsReachedLimit: 0,
          storageReachedLimit: 0,
        },
        upgradeOpportunities: {
          whatsappLimitReachedClinics: 0,
          doctorAccountUpgradeNeededClinics: 0,
          storageUpgradeNeededClinics: 0,
        },
      };
    }

    const activeClinicIds = Array.from(activeSubscriptionsByClinic.keys());
    const limitByPlanFeature = new Map<string, (typeof limits)[number]>();

    for (const limit of limits) {
      limitByPlanFeature.set(`${limit.planId}:${limit.featureKey}`, limit);
    }

    const [
      activeAddOns,
      whatsappUsages,
      doctorCounts,
      patientGalleryRecords,
      doctorGalleryRecords,
      prescriptionRecords,
      reportRecords,
    ] = await Promise.all([
      database
        .select({
          clinicId: SubscriptionAddOnModel.ownerId,
          featureKey: AddOnModel.featureKey,
          unitValue: AddOnModel.unitValue,
          quantity: SubscriptionAddOnModel.quantity,
        })
        .from(SubscriptionAddOnModel)
        .innerJoin(
          AddOnModel,
          eq(AddOnModel.id, SubscriptionAddOnModel.addOnId)
        )
        .where(
          and(
            inArray(SubscriptionAddOnModel.ownerId, activeClinicIds),
            eq(SubscriptionAddOnModel.status, 'active'),
            eq(AddOnModel.isActive, true)
          )
        ),
      database
        .select({
          clinicId: ClinicUsageModel.clinicId,
          usageCount: sql<number>`COALESCE(SUM(${ClinicUsageModel.usageCount}), 0)::int`,
        })
        .from(ClinicUsageModel)
        .where(
          and(
            inArray(ClinicUsageModel.clinicId, activeClinicIds),
            eq(ClinicUsageModel.featureKey, LIMIT_KEYS.WHATSAPP_MESSAGES),
            gte(ClinicUsageModel.periodStart, currentPeriodStart),
            lte(ClinicUsageModel.periodEnd, currentPeriodEnd)
          )
        )
        .groupBy(ClinicUsageModel.clinicId),
      database
        .select({
          clinicId: ClinicAssignModel.clinicId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(ClinicAssignModel)
        .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
        .where(
          and(
            inArray(ClinicAssignModel.clinicId, activeClinicIds),
            or(
              eq(UserModel.userType, 'Doctor'),
              and(
                eq(UserModel.userType, 'Admin'),
                eq(UserModel.isAdminDoctorAccess, true)
              )
            )
          )
        )
        .groupBy(ClinicAssignModel.clinicId),
      database
        .select({
          clinicId: AppointmentModel.clinicId,
          createdAt: patientGallery.createdAt,
        })
        .from(patientGallery)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, patientGallery.appointmentId)
        )
        .where(inArray(AppointmentModel.clinicId, activeClinicIds)),
      database
        .select({
          clinicId: ClinicAssignModel.clinicId,
          createdAt: doctorGallery.createdAt,
        })
        .from(doctorGallery)
        .innerJoin(
          ClinicAssignModel,
          eq(ClinicAssignModel.userId, doctorGallery.doctorId)
        )
        .where(inArray(ClinicAssignModel.clinicId, activeClinicIds)),
      database
        .select({
          clinicId: AppointmentModel.clinicId,
          createdAt: ReportCardModel.createdAt,
        })
        .from(ReportCardModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, ReportCardModel.appointmentId)
        )
        .where(
          and(
            inArray(AppointmentModel.clinicId, activeClinicIds),
            sql`${ReportCardModel.prescriptionPdf} IS NOT NULL`
          )
        ),
      database
        .select({
          clinicId: AppointmentModel.clinicId,
          createdAt: ReportsModel.createdAt,
        })
        .from(ReportsModel)
        .innerJoin(
          ReportCardModel,
          eq(ReportCardModel.reportId, ReportsModel.id)
        )
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, ReportCardModel.appointmentId)
        )
        .where(
          and(
            inArray(AppointmentModel.clinicId, activeClinicIds),
            sql`${ReportsModel.reportDocs} IS NOT NULL`
          )
        ),
    ]);

    const addOnLimitByClinicFeature = new Map<string, number>();
    for (const addOn of activeAddOns) {
      const featureKey = mapAddOnFeatureKey(addOn.featureKey);
      addMapValue(
        addOnLimitByClinicFeature,
        `${addOn.clinicId}:${featureKey}`,
        toNumber(addOn.unitValue) * toNumber(addOn.quantity)
      );
    }

    const whatsappUsageByClinic = new Map(
      whatsappUsages.map((usage) => [
        usage.clinicId,
        toNumber(usage.usageCount),
      ])
    );
    const doctorCountByClinic = new Map(
      doctorCounts.map((row) => [row.clinicId, toNumber(row.count)])
    );

    const storageRecordsByClinic = new Map<string, Date[]>();
    for (const record of [
      ...patientGalleryRecords,
      ...doctorGalleryRecords,
      ...prescriptionRecords,
      ...reportRecords,
    ]) {
      const records = storageRecordsByClinic.get(record.clinicId) ?? [];
      records.push(record.createdAt);
      storageRecordsByClinic.set(record.clinicId, records);
    }

    const upgradeOpportunities = {
      whatsappLimitReachedClinics: 0,
      doctorAccountUpgradeNeededClinics: 0,
      storageUpgradeNeededClinics: 0,
    };

    for (const subscription of activeSubscriptionsByClinic.values()) {
      const whatsappLimit = limitByPlanFeature.get(
        `${subscription.planId}:${LIMIT_KEYS.WHATSAPP_MESSAGES}`
      );
      const doctorLimit = limitByPlanFeature.get(
        `${subscription.planId}:${LIMIT_KEYS.DOCTOR_ACCOUNTS}`
      );
      const storageLimit = limitByPlanFeature.get(
        `${subscription.planId}:${LIMIT_KEYS.STORAGE_MONTHS}`
      );

      if (
        whatsappLimit?.enabled &&
        !whatsappLimit.isUnlimited &&
        toNumber(whatsappLimit.limitValue) > 0 &&
        (whatsappUsageByClinic.get(subscription.clinicId) ?? 0) >=
          toNumber(whatsappLimit.limitValue)
      ) {
        upgradeOpportunities.whatsappLimitReachedClinics += 1;
      }

      const totalDoctorLimit =
        toNumber(doctorLimit?.limitValue) +
        (addOnLimitByClinicFeature.get(
          `${subscription.clinicId}:${LIMIT_KEYS.DOCTOR_ACCOUNTS}`
        ) ?? 0);

      if (
        doctorLimit?.enabled &&
        !doctorLimit.isUnlimited &&
        totalDoctorLimit > 0 &&
        (doctorCountByClinic.get(subscription.clinicId) ?? 0) >=
          totalDoctorLimit
      ) {
        upgradeOpportunities.doctorAccountUpgradeNeededClinics += 1;
      }

      const totalStorageRetention =
        toNumber(storageLimit?.limitValue) +
        (addOnLimitByClinicFeature.get(
          `${subscription.clinicId}:${LIMIT_KEYS.STORAGE_MONTHS}`
        ) ?? 0);

      if (
        storageLimit?.enabled &&
        !storageLimit.isUnlimited &&
        totalStorageRetention > 0 &&
        (storageRecordsByClinic.get(subscription.clinicId) ?? []).some(
          (createdAt) =>
            isDateOutsideRetention(createdAt, totalStorageRetention, now)
        )
      ) {
        upgradeOpportunities.storageUpgradeNeededClinics += 1;
      }
    }

    const usageInsights = {
      whatsappUsageReachedLimit: percentage(
        upgradeOpportunities.whatsappLimitReachedClinics,
        stats.totalSubscribers
      ),
      doctorAccountsReachedLimit: percentage(
        upgradeOpportunities.doctorAccountUpgradeNeededClinics,
        stats.totalSubscribers
      ),
      storageReachedLimit: percentage(
        upgradeOpportunities.storageUpgradeNeededClinics,
        stats.totalSubscribers
      ),
    };

    return {
      stats,
      usageInsights,
      upgradeOpportunities,
    };
  }

  /**
   * Invalidate all caches related to a plan update.
   * Clears: plan_limit keys + clinic_plan + clinic_limits_overview for all clinics on this plan.
   */
  static async invalidatePlanCaches(planId: string): Promise<void> {
    await redisClient.del(CacheKeys.allPlans);
    // 1. Clear all plan_limit:planId:* keys
    const planLimitKeys = await redisClient.keys(
      CacheKeys.planLimitPattern(planId)
    );
    if (planLimitKeys.length > 0) {
      await redisClient.del(...planLimitKeys);
    }

    // 2. Every clinic on any version of this plan, current or past
    const clinics = await database
      .selectDistinct({ clinicId: SubscriptionModel.ownerId })
      .from(SubscriptionModel)
      .innerJoin(
        PlanVersionModel,
        eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
      )
      .where(
        and(
          eq(SubscriptionModel.ownerType, 'clinic'),
          eq(PlanVersionModel.planId, planId)
        )
      );

    // 3. Clear clinic-level caches for each affected clinic
    const clinicKeys: string[] = [];
    for (const clinic of clinics) {
      clinicKeys.push(
        CacheKeys.clinicPlan(clinic.clinicId),
        CacheKeys.clinicLimitsOverview(clinic.clinicId),
        CacheKeys.clinicActiveSubscription(clinic.clinicId),
        CacheKeys.clinicDetails(clinic.clinicId)
      );
    }

    if (clinicKeys.length > 0) {
      await redisClient.del(...clinicKeys);
    }

    // 4. Also clear any clinic_limits_overview keys by pattern (catches edge cases)
    const overviewKeys = await redisClient.keys('clinic_limits_overview:*');
    if (overviewKeys.length > 0) {
      await redisClient.del(...overviewKeys);
    }

    logger.info(
      `[PlanLimits] Cache invalidated: ${planLimitKeys.length} plan keys, ${clinics.length} clinic(s), ${overviewKeys.length} overview keys cleared`
    );
  }
}
