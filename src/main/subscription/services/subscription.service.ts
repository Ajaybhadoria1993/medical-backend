// src/main/subscription/services/subscription.service.ts
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { SubscriptionPlanModel } from '../models/subscription.model';
import { PlanFeaturesModel } from '../models/planFeatures.model';
import { AddOnModel, PlanAddOnLimitsModel } from '../models/addon.model';
import { AddOnService } from './addon.service';
import { PlansService } from './core/plans.service';
import { PlanVersionModel } from '../models/planVersion.model';
import { eq, asc, desc, inArray } from 'drizzle-orm';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../utils/cache.util';

export class SubscriptionService {
  static async updatePlan(
    id: string,
    payload: {
      slug?: string;
      name?: string;
      description?: string;
      price?: string | number;
      currency?: string;
      compareAtMonthly?: number | null;
      compareAtYearly?: number | null;
      addOnLimits?: {
        addOnId: string;
        maxCap?: number | null;
        isAllowed?: boolean;
      }[];
    }
  ) {
    // The price lives on the version; only a version no clinic is on can take a new one.
    if (payload.price !== undefined) {
      const latest = await PlansService.latestVersion(id);
      if (Number(latest.monthlyPrice ?? NaN) !== Number(payload.price)) {
        const version = await PlansService.editableVersion(id);
        await database
          .update(PlanVersionModel)
          .set({ monthlyPrice: String(payload.price) })
          .where(eq(PlanVersionModel.id, version.id));
      }
    }
    const [updated] = await database
      .update(SubscriptionPlanModel)
      .set({
        ...(payload.slug !== undefined && { slug: payload.slug }),
        ...(payload.name !== undefined && { name: payload.name }),
        ...(payload.description !== undefined && {
          description: payload.description,
        }),
        ...(payload.price !== undefined && { price: String(payload.price) }),
        ...(payload.currency !== undefined && { currency: payload.currency }),
        ...(payload.compareAtMonthly !== undefined && {
          compareAtMonthly: payload.compareAtMonthly?.toFixed(2) ?? null,
        }),
        ...(payload.compareAtYearly !== undefined && {
          compareAtYearly: payload.compareAtYearly?.toFixed(2) ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionPlanModel.id, id))
      .returning();

    if (!updated) {
      throw new HttpError(404, 'Subscription plan not found');
    }

    if (payload.addOnLimits && payload.addOnLimits.length > 0) {
      for (const limit of payload.addOnLimits) {
        await AddOnService.setPlanAddOnLimit(id, limit.addOnId, {
          maxCap: limit.maxCap,
        });
      }
    }

    await invalidateCache(CacheKeys.allPlans);
    return updated;
  }

  static async getPlans() {
    return getOrSetCache(CacheKeys.allPlans, 10 * 60, () =>
      SubscriptionService.loadPlans()
    );
  }

  private static async loadPlans() {
    // Fetch all plans
    const plans = await database
      .select()
      .from(SubscriptionPlanModel)
      .orderBy(asc(SubscriptionPlanModel.price));

    if (plans.length === 0) return [];

    // Features and add-on caps of the version in force now.
    const planIds = plans.map((p) => p.id);
    const current = await PlansService.currentVersions(planIds);
    const versionIds = [...current.values()].map((v) => v.id);
    if (!versionIds.length)
      return plans.map((plan) => ({
        ...plan,
        version: null,
        features: [],
        addOnLimits: [],
      }));
    const features = await database
      .select()
      .from(PlanFeaturesModel)
      .where(inArray(PlanFeaturesModel.planVersionId, versionIds))
      .orderBy(
        desc(PlanFeaturesModel.isMarketingFeature),
        asc(PlanFeaturesModel.sortOrder),
        asc(PlanFeaturesModel.createdAt)
      );

    // Fetch plan add-on limits for all plans
    const addOnLimits = await database
      .select({
        id: PlanAddOnLimitsModel.id,
        planId: PlanAddOnLimitsModel.planId,
        addOnId: PlanAddOnLimitsModel.addOnId,
        maxCap: PlanAddOnLimitsModel.maxCap,
        addOnName: AddOnModel.name,
        featureKey: AddOnModel.featureKey,
      })
      .from(PlanAddOnLimitsModel)
      .innerJoin(AddOnModel, eq(PlanAddOnLimitsModel.addOnId, AddOnModel.id))
      .where(inArray(PlanAddOnLimitsModel.planVersionId, versionIds));

    return plans.map((plan) => ({
      ...plan,
      // What checkout charges: the live version's monthly price, not the legacy column.
      price: current.get(plan.id)?.monthlyPrice ?? plan.price,
      version: current.get(plan.id) ?? null,
      features: PlansService.forSale(
        features.filter((f) => f.planId === plan.id)
      ),
      addOnLimits: addOnLimits.filter((a) => a.planId === plan.id),
    }));
  }
}
