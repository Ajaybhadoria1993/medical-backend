import express from 'express';

import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getAllUpdateConfigsController,
  getUpdateConfigController,
  createUpdateConfigController,
  updateUpdateConfigController,
} from '../../controllers/appUpdate.controller';
import {
  createUpdateConfigSchema,
  updateUpdateConfigSchema,
  getUpdateConfigSchema,
} from '../../schemas/appUpdate.schemas';

const appUpdateRouter = express.Router();

/**
 * @route GET /api/v1/app-update/all
 * @desc Get all app update configs (for admin panel)
 * @access Private (Super Admin)
 */
appUpdateRouter.get(
  '/all',
  requireAuth,
  requireSuperAdmin,
  getAllUpdateConfigsController
);

/**
 * @route GET /api/v1/app-update?app_name=doctor&platform=ios
 * @desc Get app update config for a specific app + platform (public, cached)
 * @access Public
 */
appUpdateRouter.get(
  '/',
  validate(getUpdateConfigSchema, 'query'),
  getUpdateConfigController
);

/**
 * @route POST /api/v1/app-update
 * @desc Create app update config for a specific app + platform
 * @access Private (Super Admin)
 */
appUpdateRouter.post(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(createUpdateConfigSchema, 'body'),
  createUpdateConfigController
);

/**
 * @route PUT /api/v1/app-update
 * @desc Update app update config for a specific app + platform
 * @access Private (Super Admin)
 */
appUpdateRouter.put(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(updateUpdateConfigSchema, 'body'),
  updateUpdateConfigController
);

export default appUpdateRouter;
