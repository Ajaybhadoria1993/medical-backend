import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabHomeCollectionService } from '../services/labHomeCollection.service';
import { getLabControllerContext } from './labControllerContext';

export const addLabHomeCollectionPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const rate = await LabHomeCollectionService.addPricing(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(res, 'Home collection pricing added successfully', rate);
  }
);

export const getLabHomeCollectionPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabHomeCollectionService.getPricing(
      req.validatedQuery,
      getLabControllerContext(req)
    );

    sendOk(res, 'Home collection pricing fetched successfully', result);
  }
);

export const updateLabHomeCollectionPricingController = asyncHandler(
  async (req: Request, res: Response) => {
    const rate = await LabHomeCollectionService.updatePricing(
      req.validatedParams.homeCollectionId,
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Home collection pricing updated successfully', rate);
  }
);
