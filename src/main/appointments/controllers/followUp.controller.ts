import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { FollowUpService } from '../services/followUp.service';

export const getFollowUpsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await FollowUpService.list(
      req.clinicId,
      req.user,
      req.validatedQuery
    );
    return sendOk(res, 'Follow-ups fetched successfully', result);
  }
);

export const getFollowUpCallsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await FollowUpService.calls(
      req.clinicId,
      req.user,
      req.validatedQuery
    );
    return sendOk(res, 'Follow-up calls fetched successfully', result);
  }
);

export const logFollowUpCallController = asyncHandler(
  async (req: Request, res: Response) => {
    await FollowUpService.logCall(req.clinicId, req.user, req.validatedBody);
    return sendCreated(res, 'Call logged', null);
  }
);

export const dismissFollowUpController = asyncHandler(
  async (req: Request, res: Response) => {
    await FollowUpService.dismiss(req.clinicId, req.user, req.validatedBody);
    return sendCreated(res, 'Follow-up marked done', null);
  }
);

export const checkFollowUpDateController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await FollowUpService.checkDate(
      req.clinicId,
      req.user,
      req.validatedQuery
    );
    return sendOk(res, 'Follow-up date checked', result);
  }
);
