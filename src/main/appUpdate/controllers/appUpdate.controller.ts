import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { AppUpdateService } from '../services/appUpdate.service';
import { GetUpdateConfigDto } from '../schemas/appUpdate.schemas';

/**
 * GET /api/v1/app-update/all
 * Retrieve all app update configs. Super Admin only.
 */
export const getAllUpdateConfigsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.getAllConfigs();
    return sendOk(res, 'All app update configs retrieved successfully', data);
  }
);

/**
 * GET /api/v1/app-update?app_name=doctor&platform=ios
 * Retrieve app update config for a specific app + platform (public, cached).
 * Returns empty object {} if no config exists.
 */
export const getUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const query: GetUpdateConfigDto = {
      app_name: req.query.app_name as string,
      platform: req.query.platform as 'ios' | 'android',
    };

    const data = await AppUpdateService.getConfig(query);

    if (!data) {
      return res.status(200).json({});
    }

    return sendOk(res, 'App update config retrieved successfully', data);
  }
);

/**
 * POST /api/v1/app-update
 * Create app update config for a specific app + platform. Super Admin only.
 */
export const createUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.createConfig(req.body);
    return sendCreated(res, 'App update config created successfully', data);
  }
);

/**
 * PUT /api/v1/app-update
 * Update app update config for a specific app + platform. Super Admin only.
 */
export const updateUpdateConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AppUpdateService.updateConfig(req.body);
    return sendOk(res, 'App update config updated successfully', data);
  }
);
