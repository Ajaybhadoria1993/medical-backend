import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../../utils/response.utils';
import { AddOnAdminService } from '../../services/core/addOnAdmin.service';

export const listAddOns = asyncHandler(async (_req: Request, res: Response) => {
  const addOns = await AddOnAdminService.list();
  return sendOk(res, 'Add-ons fetched successfully', addOns);
});

export const listAddOnPrices = asyncHandler(
  async (req: Request, res: Response) => {
    const prices = await AddOnAdminService.prices(req.validatedParams.addOnId);
    return sendOk(res, 'Add-on prices fetched successfully', prices);
  }
);

export const updateAddOn = asyncHandler(async (req: Request, res: Response) => {
  const addOn = await AddOnAdminService.update(
    req.validatedParams.addOnId,
    req.validatedBody
  );
  return sendOk(res, 'Add-on updated', addOn);
});

export const scheduleAddOnPrice = asyncHandler(
  async (req: Request, res: Response) => {
    const price = await AddOnAdminService.schedulePrice(
      req.validatedParams.addOnId,
      req.validatedBody,
      req.user?.id ?? null
    );
    return sendCreated(res, 'Price change scheduled', price);
  }
);

export const cancelAddOnPrice = asyncHandler(
  async (req: Request, res: Response) => {
    const { addOnId, priceId } = req.validatedParams;
    await AddOnAdminService.cancelPrice(addOnId, priceId);
    return sendOk(res, 'Price change cancelled. The current price stays.', {
      id: priceId,
    });
  }
);
