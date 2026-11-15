import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReferralCodeService } from '../services/referralCode.service';
import { ReferralQueryService } from '../services/referralQuery.service';

// The owner always comes from the token, never from the request.

export const getMyReferralCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { code } = await ReferralCodeService.getOrCreate(req.user!.id, {
      clinicId: req.clinicId,
      labId: req.labId,
    });
    const link = `${process.env.FRONTEND_URL}/signup-email?rfc=${code}`;
    return sendOk(res, 'Referral code fetched successfully', { code, link });
  }
);

export const getMyReferralsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ReferralQueryService.mine(
      req.user!.id,
      req.validatedQuery
    );
    return sendOk(res, 'Referrals fetched successfully', data);
  }
);
