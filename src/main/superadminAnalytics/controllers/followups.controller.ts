import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { FollowupsService } from '../services/followups.service';

export const listFollowupsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await FollowupsService.list(req.validatedQuery, req.user!.id);
    return sendOk(res, 'Follow-ups fetched successfully', data);
  }
);

export const getFollowupController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await FollowupsService.detail(req.validatedParams.taskId);
    return sendOk(res, 'Follow-up fetched successfully', data);
  }
);

export const actOnFollowupController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await FollowupsService.act(
      req.validatedParams.taskId,
      req.user!.id,
      req.validatedBody
    );
    return sendOk(res, 'Follow-up updated successfully', data);
  }
);

export const runFollowupRulesController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await FollowupsService.runRules();
    return sendOk(res, 'Follow-up rules ran successfully', data);
  }
);
