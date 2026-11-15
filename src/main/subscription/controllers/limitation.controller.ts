import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { LimitationService } from '../services/limitation.service';

/**
 * GET /api/v1/users/limitations/overview
 * Get all plan limits and current usage for the authenticated clinic
 */
export const getClinicLimitsOverview = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const overview = await LimitationService.getClinicLimitsOverview(clinicId);

    return sendOk(res, 'Clinic limits overview fetched successfully', overview);
  }
);
