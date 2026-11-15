import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PlanPricingService } from '../services/billing/planPricing.service';

/** Same pricing as checkout, so the price shown is the price charged. */
export const quotePlanPurchase = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { planId, billingCycle, couponCode } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const quote = await PlanPricingService.quote({
      clinicId,
      planId,
      cycle: billingCycle,
      couponCode,
    });

    return sendOk(
      res,
      'Plan quote fetched successfully',
      PlanPricingService.toResponse(quote)
    );
  }
);
