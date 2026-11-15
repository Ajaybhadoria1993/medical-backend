import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { SpecialtyDefaultsService } from '../services/specialtyDefaults.service';

export const listSpecialtyDefaultsController = asyncHandler(
  async (_req: Request, res: Response) =>
    sendOk(
      res,
      'Specialty defaults fetched successfully',
      await SpecialtyDefaultsService.list()
    )
);

export const getSpecialtyImagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = SpecialtyDefaultsService.referenceImages(
      req.validatedParams.speciality
    );
    return sendOk(res, 'Specialty images fetched successfully', data);
  }
);
