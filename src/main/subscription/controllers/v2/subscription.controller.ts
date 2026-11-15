import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { FirstPlanService } from '../../services/core/firstPlan.service';
import { SubscriptionOverviewService } from '../../services/core/subscriptionOverview.service';

export const startTrial = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = req.clinicId;
  if (!clinicId) {
    throw new HttpError(400, 'Clinic ID is required');
  }

  const out = await FirstPlanService.requestOrStartTrial(
    'clinic',
    clinicId,
    req.user?.id ?? null
  );
  // Before approval the trial is only requested; approval starts it.
  if (out.requested) {
    return sendOk(
      res,
      'Free trial requested. It starts when a Super Admin approves your clinic.',
      { requested: true, requestedAt: out.requestedAt }
    );
  }
  return sendOk(
    res,
    `Free trial for ${out.planName} plan activated successfully (${out.trialDays} days)`,
    out.trial
  );
});

/** GET /api/v2/subscription/catalog — plans and add-on prices, the same for every clinic. */
export const getSubscriptionCatalog = asyncHandler(
  async (_req: Request, res: Response) => {
    const catalog = await SubscriptionOverviewService.catalog();
    return sendOk(res, 'Subscription catalog fetched successfully', catalog);
  }
);

/** GET /api/v2/subscription/overview — the clinic's billing page data in one call. */
export const getSubscriptionPage = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(400, 'Clinic context required');
    const page = await SubscriptionOverviewService.page(clinicId);
    return sendOk(res, 'Subscription overview fetched successfully', page);
  }
);
