import { Request, Response } from 'express';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { doctorGallery, patientGallery } from '../../appointments/models';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import {
  ReportCardModel,
  ReportsModel,
} from '../../reports/models/reports.model';
import { UserModel } from '../../users/models/user.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import { ClinicUsageModel } from '../models/clinicUsage.model';
import { PlanFeaturesModel } from '../models/planFeatures.model';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

interface PlanLimitsStats {
  totalPlans: number;
  totalSubscribers: number;
  monthlyRecurringRevenue: number;
  totalFeaturesManaged: number;
}

interface UsageInsights {
  whatsappUsageReachedLimit: number;
  doctorAccountsReachedLimit: number;
  storageReachedLimit: number;
}

interface UpgradeOpportunities {
  whatsappLimitReachedClinics: number;
  doctorAccountUpgradeNeededClinics: number;
  storageUpgradeNeededClinics: number;
}

interface PlanLimitRow {
  id: string;
  planId: string;
  featureKey: string;
  limitValue: number | null;
  isUnlimited: boolean;
  enabled: boolean;
  description: string | null;
}

const FEATURE_KEYS = {
  WHATSAPP_MESSAGES: 'whatsapp_messages_per_month',
  DOCTOR_ACCOUNTS: 'doctor_accounts',
  STORAGE_MONTHS: 'storage_months',
  CLOUD_STORAGE: 'cloud_storage',
} as const;

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const percentage = (count: number, total: number): number => {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
};

const mapAddOnFeatureKey = (featureKey: string): string => {
  switch (featureKey) {
    case 'additional_doctor':
      return FEATURE_KEYS.DOCTOR_ACCOUNTS;
    case 'additional_storage':
      return FEATURE_KEYS.CLOUD_STORAGE;
    default:
      return featureKey;
  }
};

const addMapValue = (
  map: Map<string, number>,
  key: string,
  value: number
): void => {
  map.set(key, (map.get(key) ?? 0) + value);
};

const isDateOutsideRetention = (
  createdAt: Date,
  retentionMonths: number,
  now: Date
): boolean => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  return createdAt <= cutoff;
};

async function getReadablePlanLimits(): Promise<PlanLimitRow[]> {
  try {
    return await database
      .select({
        id: PlanFeaturesModel.id,
        planId: PlanFeaturesModel.planId,
        featureKey: PlanFeaturesModel.featureKey,
        limitValue: PlanFeaturesModel.limitValue,
        isUnlimited: PlanFeaturesModel.isUnlimited,
        enabled: PlanFeaturesModel.enabled,
        description: PlanFeaturesModel.description,
      })
      .from(PlanFeaturesModel);
  } catch (error) {
    logger.warn(
      '[PlanLimits] Falling back to legacy plan_limits table for reads',
      error
    );

    const legacyLimits = (await database.execute(sql`
      SELECT
        id,
        plan_id AS "planId",
        feature_key AS "featureKey",
        limit_value AS "limitValue",
        is_unlimited AS "isUnlimited",
        enabled,
        description
      FROM plan_limits
    `)) as Record<string, unknown>[];

    return legacyLimits.map((limit) => ({
      id: String(limit.id),
      planId: String(limit.planId),
      featureKey: String(limit.featureKey),
      limitValue:
        limit.limitValue === null || limit.limitValue === undefined
          ? null
          : toNumber(limit.limitValue),
      isUnlimited: Boolean(limit.isUnlimited),
      enabled: Boolean(limit.enabled),
      description:
        limit.description === null || limit.description === undefined
          ? null
          : String(limit.description),
    }));
  }
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
async function getPlanLimitsDashboardAnalytics(): Promise<{
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
    getReadablePlanLimits(),
    database
      .select({
        clinicId: ClinicSubscriptionModel.clinicId,
        planId: ClinicSubscriptionModel.planId,
        price: ClinicSubscriptionModel.price,
      })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.active, true),
          or(
            isNull(ClinicSubscriptionModel.expiresAt),
            gte(ClinicSubscriptionModel.expiresAt, now)
          )
        )
      )
      .orderBy(
        ClinicSubscriptionModel.clinicId,
        desc(ClinicSubscriptionModel.createdAt)
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
  const totalFeaturesManaged = new Set(limits.map((limit) => limit.featureKey))
    .size;

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
        clinicId: ClinicAddOnModel.clinicId,
        featureKey: AddOnModel.featureKey,
        unitValue: AddOnModel.unitValue,
        quantity: ClinicAddOnModel.quantity,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(AddOnModel.id, ClinicAddOnModel.addOnId))
      .where(
        and(
          inArray(ClinicAddOnModel.clinicId, activeClinicIds),
          eq(ClinicAddOnModel.isActive, true),
          eq(AddOnModel.isActive, true),
          or(
            isNull(ClinicAddOnModel.expiresAt),
            gte(ClinicAddOnModel.expiresAt, now)
          )
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
          eq(ClinicUsageModel.featureKey, FEATURE_KEYS.WHATSAPP_MESSAGES),
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
      .innerJoin(ReportCardModel, eq(ReportCardModel.reportId, ReportsModel.id))
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
    whatsappUsages.map((usage) => [usage.clinicId, toNumber(usage.usageCount)])
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
      `${subscription.planId}:${FEATURE_KEYS.WHATSAPP_MESSAGES}`
    );
    const doctorLimit = limitByPlanFeature.get(
      `${subscription.planId}:${FEATURE_KEYS.DOCTOR_ACCOUNTS}`
    );
    const storageLimit = limitByPlanFeature.get(
      `${subscription.planId}:${FEATURE_KEYS.STORAGE_MONTHS}`
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
        `${subscription.clinicId}:${FEATURE_KEYS.DOCTOR_ACCOUNTS}`
      ) ?? 0);

    if (
      doctorLimit?.enabled &&
      !doctorLimit.isUnlimited &&
      totalDoctorLimit > 0 &&
      (doctorCountByClinic.get(subscription.clinicId) ?? 0) >= totalDoctorLimit
    ) {
      upgradeOpportunities.doctorAccountUpgradeNeededClinics += 1;
    }

    const totalStorageRetention =
      toNumber(storageLimit?.limitValue) +
      (addOnLimitByClinicFeature.get(
        `${subscription.clinicId}:${FEATURE_KEYS.STORAGE_MONTHS}`
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
async function invalidateAllCachesForPlan(planId: string): Promise<void> {
  // 1. Clear all plan_limit:planId:* keys
  const planLimitKeys = await redisClient.keys(`plan_limit:${planId}:*`);
  if (planLimitKeys.length > 0) {
    await redisClient.del(...planLimitKeys);
  }

  // 2. Find all clinics that have ANY subscription to this plan (active or not)
  const clinics = await database
    .select({ clinicId: ClinicSubscriptionModel.clinicId })
    .from(ClinicSubscriptionModel)
    .where(eq(ClinicSubscriptionModel.planId, planId));

  // 3. Clear clinic-level caches for each affected clinic
  const clinicKeys: string[] = [];
  for (const clinic of clinics) {
    clinicKeys.push(
      `clinic_plan:${clinic.clinicId}`,
      `clinic_limits_overview:${clinic.clinicId}`,
      `clinic_active_subscription:${clinic.clinicId}`,
      `clinic_details:${clinic.clinicId}`
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

/**
 * GET /api/v1/users/plan-limits/
 * Get all plan limits grouped by plan
 */
export const getAllPlanLimits = asyncHandler(
  async (_req: Request, res: Response) => {
    const [plans, limits, analytics] = await Promise.all([
      database.select().from(SubscriptionPlanModel),
      getReadablePlanLimits(),
      getPlanLimitsDashboardAnalytics(),
    ]);

    const grouped = plans.map((plan) => ({
      planId: plan.id,
      planSlug: plan.slug,
      planName: plan.name,
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
    }));

    return res.status(200).json({
      success: true,
      message: 'Plan limits fetched successfully',
      stats: analytics.stats,
      usageInsights: analytics.usageInsights,
      upgradeOpportunities: analytics.upgradeOpportunities,
      data: grouped,
    });
  }
);

/**
 * GET /api/v1/users/plan-limits/:planId
 * Get limits for a specific plan
 */
export const getPlanLimitsById = asyncHandler(
  async (req: Request, res: Response) => {
    const planId = req.params.planId as string;

    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    const limits = (await getReadablePlanLimits()).filter(
      (limit) => limit.planId === planId
    );

    return sendOk(res, 'Plan limits fetched successfully', {
      planId: plan.id,
      planSlug: plan.slug,
      planName: plan.name,
      limits,
    });
  }
);

/**
 * PUT /api/v1/users/plan-limits/:planId
 * Update limits for a specific plan (bulk upsert)
 *
 * Body: { limits: [{ featureKey, limitValue, isUnlimited, enabled, description }] }
 */
export const updatePlanLimits = asyncHandler(
  async (req: Request, res: Response) => {
    const planId = req.params.planId as string;
    const { limits } = req.body;

    if (!Array.isArray(limits) || limits.length === 0) {
      throw new HttpError(400, 'limits array is required');
    }

    // Verify plan exists
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    // Upsert each limit
    const results = [];
    for (const limit of limits) {
      const [row] = await database
        .insert(PlanFeaturesModel)
        .values({
          planId,
          featureKey: limit.featureKey,
          limitValue: limit.limitValue ?? null,
          isUnlimited: limit.isUnlimited ?? false,
          enabled: limit.enabled ?? true,
          description: limit.description ?? null,
        })
        .onConflictDoUpdate({
          target: [PlanFeaturesModel.planId, PlanFeaturesModel.featureKey],
          set: {
            limitValue: limit.limitValue ?? null,
            isUnlimited: limit.isUnlimited ?? false,
            enabled: limit.enabled ?? true,
            description: limit.description ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      results.push(row);
    }

    // Invalidate all caches for this plan + affected clinics
    await invalidateAllCachesForPlan(planId);

    return sendOk(
      res,
      `Updated ${results.length} limit(s) for plan "${plan.name}"`,
      results
    );
  }
);

/**
 * PATCH /api/v1/users/plan-limits/:planId/:featureKey
 * Update a single limit for a plan
 *
 * Body: { limitValue?, isUnlimited?, enabled?, description? }
 */
export const updateSinglePlanLimit = asyncHandler(
  async (req: Request, res: Response) => {
    const planId = req.params.planId as string;
    const featureKey = req.params.featureKey as string;
    const { limitValue, isUnlimited, enabled, description } = req.body;

    // Verify plan exists
    const [plan] = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId))
      .limit(1);

    if (!plan) {
      throw new HttpError(404, 'Plan not found');
    }

    const [row] = await database
      .insert(PlanFeaturesModel)
      .values({
        planId,
        featureKey,
        limitValue: limitValue ?? null,
        isUnlimited: isUnlimited ?? false,
        enabled: enabled ?? true,
        description: description ?? null,
      })
      .onConflictDoUpdate({
        target: [PlanFeaturesModel.planId, PlanFeaturesModel.featureKey],
        set: {
          ...(limitValue !== undefined && { limitValue }),
          ...(isUnlimited !== undefined && { isUnlimited }),
          ...(enabled !== undefined && { enabled }),
          ...(description !== undefined && { description }),
          updatedAt: new Date(),
        },
      })
      .returning();

    // Invalidate all caches for this plan + affected clinics
    await invalidateAllCachesForPlan(planId);

    return sendOk(res, `Updated "${featureKey}" for plan "${plan.name}"`, row);
  }
);
