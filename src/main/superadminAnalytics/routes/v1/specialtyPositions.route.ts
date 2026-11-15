import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { saveSpecialtyOrderController } from '../../controllers/specialtyOrder.controller';
import { specialtyOrderBodySchema } from '../../schemas/specialtyOrder.schema';

// Mounted at /api/v1/superadmin-analytics/specialty-positions; read via GET /doctor/specialties.
const specialtyOrderRouter = express.Router();

/** @route PUT /api/v1/superadmin-analytics/specialty-positions — save the main speciality order
 *  @access Super Admin; body must list all catalog main specialities once */
specialtyOrderRouter.put(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(specialtyOrderBodySchema),
  saveSpecialtyOrderController
);

export default specialtyOrderRouter;

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/superadmin-analytics/specialty-positions',
  description:
    'Save the display order of main specialities used by every specialty list (Super Admin)',
  requestSchema: specialtyOrderBodySchema,
  tags: ['superadmin'],
});
