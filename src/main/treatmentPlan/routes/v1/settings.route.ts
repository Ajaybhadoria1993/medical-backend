import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getSettingsController,
  updateSettingsController,
} from '../../controllers/settings.controller';
import {
  settingsResponseSchema,
  settingsUpdateSchema,
} from '../../schemas/settings.schema';

// Mounted at /api/v1/treatment-plan/settings; the clinic always comes from the token.
const settingsRouter = express.Router();

/** @route GET /api/v1/treatment-plan/settings — the clinic's treatment plan settings
 *  @access Admin, Doctor, Receptionist (own clinic) */
settingsRouter.get(
  '/',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  getSettingsController
);

/** @route PUT /api/v1/treatment-plan/settings — change one or more settings
 *  @access Admin (own clinic) */
settingsRouter.put(
  '/',
  requireAuth,
  requireRole(['Admin']),
  requireClinic,
  validate(settingsUpdateSchema),
  updateSettingsController
);

// Paths are relative: loadRoutes prefixes the mount path.
export const apiDocs = [
  {
    method: 'get' as const,
    path: '',
    description: "The clinic's treatment plan settings (Staff)",
    responseSchema: settingsResponseSchema,
  },
  {
    method: 'put' as const,
    path: '',
    description: 'Change treatment plan settings (Admin)',
    requestSchema: settingsUpdateSchema,
    responseSchema: settingsResponseSchema,
  },
];

export default settingsRouter;
