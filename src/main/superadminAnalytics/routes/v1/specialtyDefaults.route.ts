import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getSpecialtyImagesController,
  listSpecialtyDefaultsController,
} from '../../controllers/specialtyDefaults.controller';
import { specialtyParamSchema } from '../../schemas/specialtyDefaults.schema';

// Mounted at /api/v1/superadmin-analytics/specialty-defaults; read-only platform config.
const specialtyDefaultsRouter = express.Router();

/** @route GET /api/v1/superadmin-analytics/specialty-defaults — defaults per main speciality
 *  @access Super Admin */
specialtyDefaultsRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  listSpecialtyDefaultsController
);

/** @route GET /api/v1/superadmin-analytics/specialty-defaults/:speciality/images — default images
 *  @access Super Admin */
specialtyDefaultsRouter.get(
  '/:speciality/images',
  requireAuth,
  requireSuperAdmin,
  validate(specialtyParamSchema, 'params'),
  getSpecialtyImagesController
);

export default specialtyDefaultsRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/specialty-defaults',
  description:
    'Prescription defaults per main speciality (read-only, Super Admin)',
  tags: ['superadmin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/specialty-defaults/{speciality}/images',
  description:
    'Default gallery images for a main speciality (read-only, Super Admin)',
  params: specialtyParamSchema,
  tags: ['superadmin'],
});
