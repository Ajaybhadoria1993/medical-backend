import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PlanLimitsService } from '../services/core/planLimits.service';

/** GET /api/v1/subscription/plan-limits — every plan's limits and the dashboard numbers. */
export const getAllPlanLimits = asyncHandler(
  async (_req: Request, res: Response) => {
    const { stats, usageInsights, upgradeOpportunities, data } =
      await PlanLimitsService.overview();
    // The screen reads the numbers beside `data`, not inside it, so this one keeps its own shape.
    return res.status(200).json({
      success: true,
      message: 'Plan limits fetched successfully',
      stats,
      usageInsights,
      upgradeOpportunities,
      data,
    });
  }
);

/** PATCH /api/v1/subscription/plan-limits/:planId/:featureKey — change one limit. */
export const updateSinglePlanLimit = asyncHandler(
  async (req: Request, res: Response) => {
    const planId = req.params.planId as string;
    const featureKey = req.params.featureKey as string;
    const { plan, row } = await PlanLimitsService.updateOne(
      planId,
      featureKey,
      req.body
    );
    return sendOk(res, `Updated "${featureKey}" for plan "${plan.name}"`, row);
  }
);
