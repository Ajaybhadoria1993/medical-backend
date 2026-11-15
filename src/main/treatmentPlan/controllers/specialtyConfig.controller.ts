import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { SpecialtyConfigService } from '../services/specialtyConfig.service';

export const getSpecialtyFieldsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SpecialtyConfigService.forClinic(
      req.clinicId!,
      req.validatedParams.specialty
    );
    return sendOk(res, 'Specialty fields fetched', data);
  }
);
