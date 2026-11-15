import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import type { StartSupportSessionDto } from '../schemas/supportAccess.schema';
import { SupportSessionService } from '../services/supportSession.service';

export const startSupportSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.validatedBody as StartSupportSessionDto;
    const data = await SupportSessionService.start({
      ...body,
      superAdminId: req.user.id,
    });
    return sendCreated(res, 'Support view started', data);
  }
);

export const endAllSupportSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SupportSessionService.endAll(req.user.id);
    return sendOk(res, 'Support views ended', data);
  }
);

export const listClinicSupportSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SupportSessionService.listForClinic(
      req.validatedParams.clinicId,
      req.validatedQuery
    );
    return sendOk(res, 'Support access history fetched successfully', data);
  }
);
