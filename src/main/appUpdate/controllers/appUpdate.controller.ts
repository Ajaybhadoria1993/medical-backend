import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { AppUpdateService } from '../services/appUpdate.service';

export const getAllUpdateConfigsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.getAllConfigs();
    return sendOk(res, 'All app update configs retrieved successfully', data);
  }
);

export const getUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.getConfig(req.validatedQuery);

    // The mobile apps read a bare {} as "no config"; keep that contract.
    if (!data) {
      return res.status(200).json({});
    }

    return sendOk(res, 'App update config retrieved successfully', data);
  }
);

export const createUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.createConfig(req.validatedBody);
    return sendCreated(res, 'App update config created successfully', data);
  }
);

export const updateUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.updateConfig(req.validatedBody);
    return sendOk(res, 'App update config updated successfully', data);
  }
);
