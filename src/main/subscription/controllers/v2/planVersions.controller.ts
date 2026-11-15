import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewear/errorHandler';
import {
  CacheKeys,
  invalidateCacheByPattern,
  invalidateCacheMany,
} from '../../../../utils/cache.util';
import { sendCreated, sendOk } from '../../../../utils/response.utils';
import { LifecycleRemindersService } from '../../services/core/lifecycleReminders.service';
import { PlansService } from '../../services/core/plans.service';

// The pricing page and anyone reading "the plan's current version" must see the change.
const clearPlanCaches = async (planId: string) => {
  await invalidateCacheMany([CacheKeys.allPlans]);
  await invalidateCacheByPattern(CacheKeys.planLimitPattern(planId));
};

export const createPlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await PlansService.createPlan(
    req.validatedBody,
    req.user?.id ?? null
  );
  await invalidateCacheMany([CacheKeys.allPlans]);
  return sendCreated(
    res,
    `${plan.name} created. Put it on sale when it is ready.`,
    plan
  );
});

export const listPlanVersions = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const rows = await PlansService.versionsOf(planId);
    const contents = await PlansService.contentsOf(
      rows.map((r) => r.version.id)
    );
    const now = new Date();
    const live = rows.find((r) => r.version.effectiveFrom <= now)?.version.id;
    return sendOk(
      res,
      'Plan versions fetched successfully',
      rows.map((r) => ({
        ...r.version,
        clinics: r.clinics,
        isLive: r.version.id === live,
        ...contents.get(r.version.id),
      }))
    );
  }
);

export const createPlanVersion = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const version = await PlansService.createVersion(
      planId,
      req.validatedBody,
      req.user?.id ?? null
    );
    await clearPlanCaches(planId);
    await LifecycleRemindersService.priceChange(version);
    return sendCreated(res, `Version ${version.versionNo} created`, version);
  }
);

export const updatePlanVersion = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, versionId } = req.validatedParams;
    const version = await PlansService.updateScheduledVersion(
      planId,
      versionId,
      req.validatedBody
    );
    await clearPlanCaches(planId);
    // Clinics told the old figures get the corrected ones.
    await LifecycleRemindersService.priceChange(version, `edit-${Date.now()}`);
    return sendOk(res, `Version ${version.versionNo} updated`, version);
  }
);

export const deletePlanVersion = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, versionId } = req.validatedParams;
    const version = await PlansService.deleteScheduledVersion(
      planId,
      versionId
    );
    await clearPlanCaches(planId);
    return sendOk(
      res,
      `Version ${version.versionNo} cancelled. The current price stays.`,
      { id: version.id }
    );
  }
);

export const listPlanClinics = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const clinics = await PlansService.clinicsOn(planId);
    return sendOk(res, 'Clinics on the plan fetched successfully', clinics);
  }
);

export const renamePlanFeature = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, featureKey } = req.validatedParams;
    await PlansService.renameFeature(planId, featureKey, req.validatedBody);
    await clearPlanCaches(planId);
    return sendOk(res, 'Feature updated', { featureKey });
  }
);

export const reorderPlanFeatures = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    await PlansService.reorderFeatures(planId, req.validatedBody.featureKeys);
    await clearPlanCaches(planId);
    return sendOk(res, 'Feature order saved', null);
  }
);

export const addPlanFeature = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const feature = await PlansService.addMarketingFeature(
      planId,
      req.validatedBody
    );
    await clearPlanCaches(planId);
    return sendCreated(res, 'Feature added', feature);
  }
);

export const removePlanFeature = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId, featureKey } = req.validatedParams;
    await PlansService.removeMarketingFeature(planId, featureKey);
    await clearPlanCaches(planId);
    return sendOk(res, 'Feature removed', { featureKey });
  }
);

export const endPlan = asyncHandler(async (req: Request, res: Response) => {
  const { planId } = req.validatedParams;
  const { plan, clinics } = await PlansService.endPlan(
    planId,
    req.validatedBody
  );
  await clearPlanCaches(planId);
  return sendOk(
    res,
    `${plan.name} is ending. ${clinics} clinic${clinics === 1 ? ' was' : 's were'} emailed.`,
    plan
  );
});

export const undoEndPlan = asyncHandler(async (req: Request, res: Response) => {
  const { planId } = req.validatedParams;
  await PlansService.undoEnd(planId);
  await clearPlanCaches(planId);
  return sendOk(
    res,
    'The plan is no longer ending. It stays not sold until you put it on sale.',
    { planId }
  );
});

export const setPlanVisibility = asyncHandler(
  async (req: Request, res: Response) => {
    const { planId } = req.validatedParams;
    const plan = await PlansService.setActive(
      planId,
      req.validatedBody.isActive
    );
    await clearPlanCaches(planId);
    return sendOk(
      res,
      plan.isActive
        ? 'The plan is on sale again.'
        : 'The plan is hidden. Clinics already on it keep it.',
      plan
    );
  }
);
