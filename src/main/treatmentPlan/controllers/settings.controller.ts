import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { TreatmentPlanSettingsService } from '../services/settings.service';

// The clinic comes from the token (requireClinic), never from the request.

export const getSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TreatmentPlanSettingsService.get(req.clinicId!);
    return sendOk(res, 'Treatment plan settings fetched', data);
  }
);

export const updateSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TreatmentPlanSettingsService.update(
      req.clinicId!,
      req.validatedBody
    );
    return sendOk(res, 'Treatment plan settings saved', data);
  }
);
