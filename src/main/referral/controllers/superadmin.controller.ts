import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReferralQueryService } from '../services/referralQuery.service';

export const listAllReferralsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ReferralQueryService.all(req.validatedQuery);
    return sendOk(res, 'Referrals fetched successfully', data);
  }
);
