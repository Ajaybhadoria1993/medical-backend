import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { StaffDirectoryService } from '../services/staffDirectory.service';

export const getStaffDirectoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await StaffDirectoryService.list(
      req.clinicId,
      req.validatedQuery
    );
    return sendOk(res, 'Staff directory fetched successfully', result);
  }
);
