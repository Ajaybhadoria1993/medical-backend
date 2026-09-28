import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { SettingServices } from '../services/setting.service';

export const getSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user.id;
    const result = await SettingServices.getSetting(user);
    res.json({ success: true, ...result });
  }
);

export const updateSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user.id;
    const result = await SettingServices.updateSetting(user, req.validatedBody);
    res.json({ success: true, ...result });
  }
);

export const getNotificationPreferencesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await SettingServices.getNotificationPreferences(
      req.user.id,
      req.user.userType
    );
    res.json({ success: true, data: result });
  }
);

export const updateNotificationPreferencesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await SettingServices.updateNotificationPreferences(
      req.user.id,
      req.user.userType,
      req.validatedBody
    );
    res.json({ success: true, data: result });
  }
);

export const getDefaultPreferencesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { getRoleDefaults } =
      await import('../../notifications/preferences/notificationPreferences.constants');
    const result = getRoleDefaults(req.user.userType);
    res.json({ success: true, data: result });
  }
);
