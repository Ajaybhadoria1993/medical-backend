import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { getLabControllerContext } from './labControllerContext';
import { LabPatientsService } from '../services/labPatients.service';

export const getLabPatientsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabPatientsService.getLabPatients(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab patients fetched successfully', result);
  }
);
