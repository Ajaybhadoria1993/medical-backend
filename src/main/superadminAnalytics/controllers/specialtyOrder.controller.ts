import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { SpecialtyOrderService } from '../services/specialtyOrder.service';
import type { SpecialtyOrderBody } from '../schemas/specialtyOrder.schema';

/** Saves the full main speciality order sent by Super Admin. */
export const saveSpecialtyOrderController = asyncHandler(
  async (req: Request, res: Response) => {
    const { order } = req.validatedBody as SpecialtyOrderBody;
    await SpecialtyOrderService.save(order);
    return sendOk(res, 'Specialty order saved', { order });
  }
);
