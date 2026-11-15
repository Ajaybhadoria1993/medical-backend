import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { SupportSessionService } from '../services/supportSession.service';

export const endOwnSupportSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    await SupportSessionService.end(req.supportSession!.id);
    return sendOk(res, 'Support view ended', null);
  }
);
