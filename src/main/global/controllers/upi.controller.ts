import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { getUpiDetails } from '../services/upi.service';

export const validateUpiController = asyncHandler(
  async (req: Request, res: Response) => {
    const { upiId } = req.validatedBody;
    const result = await getUpiDetails(upiId);
    return sendOk(res, 'UPI lookup completed successfully', result);
  }
);
