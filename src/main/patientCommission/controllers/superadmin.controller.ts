import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { PricingService } from '../services/pricing.service';

export const getDefaultPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PricingService.view(null, req.validatedQuery.limit);
    return sendOk(res, 'Platform pricing fetched successfully', data);
  }
);

export const changeDefaultPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PricingService.changeDefault(
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Platform pricing saved successfully', data);
  }
);

export const listClinicPricingController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await PricingService.listOverrides();
    return sendOk(res, 'Clinic pricing fetched successfully', data);
  }
);

export const getClinicPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PricingService.view(
      req.validatedParams.clinicId,
      req.validatedQuery.limit
    );
    return sendOk(res, 'Clinic pricing fetched successfully', data);
  }
);

export const changeClinicPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PricingService.changeClinic(
      req.validatedParams.clinicId,
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Clinic pricing saved successfully', data);
  }
);
