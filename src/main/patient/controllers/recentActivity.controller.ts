import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PatientRecentActivityService } from '../services/recentActivity.service';

export const getPatientRecentActivityController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientRecentActivityService.getRecentActivity(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Recent activity fetched successfully', result);
  }
);
