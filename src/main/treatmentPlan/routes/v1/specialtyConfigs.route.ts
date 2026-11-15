import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { getSpecialtyFieldsController } from '../../controllers/specialtyConfig.controller';
import { specialtyFieldsResponse } from '../../schemas/response.schema';
import { specialtyParamSchema } from '../../schemas/specialtyConfig.schema';

// Mounted at /api/v1/treatment-plan/specialty-configs; the clinic always comes from the token.
const specialtyConfigsRouter = express.Router();

/** @route GET /api/v1/treatment-plan/specialty-configs/:specialty — the extra fields a form asks for
 *  @access Admin, Doctor, Receptionist (null when the specialty has none) */
specialtyConfigsRouter.get(
  '/:specialty',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(specialtyParamSchema, 'params'),
  getSpecialtyFieldsController
);

// Paths are relative: loadRoutes prefixes the mount path.
export const apiDocs = [
  {
    method: 'get' as const,
    path: '/:specialty',
    description: 'Extra fields for one specialty (Staff)',
    params: specialtyParamSchema,
    responseSchema: specialtyFieldsResponse,
  },
];

export default specialtyConfigsRouter;
