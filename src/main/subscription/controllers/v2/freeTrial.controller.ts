import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { TrialOverrideService } from '../../services/core/trialOverride.service';

const actor = (req: Request) => {
  if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
  return { userId: req.user.id, reason: req.validatedBody.reason as string };
};

/** GET /api/v2/subscription/free-trial — the default trial length and every clinic with its own. */
export const getFreeTrials = asyncHandler(
  async (_req: Request, res: Response) =>
    sendOk(res, 'Free trials fetched', await TrialOverrideService.overview())
);

/** POST /api/v2/subscription/free-trial/default — the trial length for clinics with no length of their own. */
export const setDefaultFreeTrial = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Default free trial saved',
      await TrialOverrideService.setDefault(req.validatedBody.days, actor(req))
    )
);

/** POST …/free-trial/clinic/:clinicId — one clinic's own trial length. */
export const setClinicFreeTrial = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Free trial saved for the clinic',
      await TrialOverrideService.setForClinic(
        req.validatedParams.clinicId,
        req.validatedBody.days,
        actor(req)
      )
    )
);

/** POST …/free-trial/clinic/:clinicId/clear — back to the default trial length. */
export const clearClinicFreeTrial = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Free trial back to the default',
      await TrialOverrideService.clearForClinic(
        req.validatedParams.clinicId,
        actor(req)
      )
    )
);
