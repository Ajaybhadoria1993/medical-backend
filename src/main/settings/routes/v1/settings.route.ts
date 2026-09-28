// src/main/settings/routes/v1/settings.route.ts
import express from 'express';

import { requireAuth } from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getSettingsController,
  updateSettingsController,
  getNotificationPreferencesController,
  updateNotificationPreferencesController,
  getDefaultPreferencesController,
} from '../../controllers/setting.controller';
import {
  updateSettingsSchema,
  updateNotificationPreferencesSchema,
} from '../../schemas/setting.schemas';
import { docsRegistry } from '../../../../utils/docsRegistry';

const settingRouter = express.Router();

/**
 * @route GET /api/v1/settings/
 * @desc Get application settings for the current user/clinic
 * @access Private
 */
settingRouter.get('/', requireAuth, getSettingsController);

/**
 * @route PUT /api/v1/settings/
 * @desc Update application settings
 * @access Private
 */
settingRouter.put(
  '/',
  requireAuth,
  validate(updateSettingsSchema, 'body'),
  updateSettingsController
);

/**
 * @route GET /api/v1/settings/notification-preferences
 * @desc Get resolved notification preferences
 * @access Private
 */
settingRouter.get(
  '/notification-preferences',
  requireAuth,
  getNotificationPreferencesController
);

/**
 * @route PUT /api/v1/settings/notification-preferences
 * @desc Update notification preferences
 * @access Private
 */
settingRouter.put(
  '/notification-preferences',
  requireAuth,
  validate(updateNotificationPreferencesSchema, 'body'),
  updateNotificationPreferencesController
);

/**
 * @route GET /api/v1/settings/notification-preferences/defaults
 * @desc Get default notification preferences for current role
 * @access Private
 */
settingRouter.get(
  '/notification-preferences/defaults',
  requireAuth,
  getDefaultPreferencesController
);

export default settingRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/settings', // full path as it would appear in the app
  description: 'get settings',
  tags: ['settings'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/settings', // full path as it would appear in the app
  description: 'update settings',
  requestSchema: updateSettingsSchema,
  tags: ['settings'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/settings/notification-preferences',
  description: 'Get resolved notification preferences for user',
  tags: ['settings'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/settings/notification-preferences',
  description: 'Update user notification preferences',
  requestSchema: updateNotificationPreferencesSchema,
  tags: ['settings'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/settings/notification-preferences/defaults',
  description: 'Get default notification preferences for user role',
  tags: ['settings'],
});
