import { Router } from 'express';
import {
  requireAuth,
  requireLab,
  requireLabClinicContext,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  createLabTestPackageController,
  getLabTestPackageByIdController,
  getLabTestPackagesController,
  updateLabTestPackageController,
} from '../../controllers/labTestPackages.controller';
import {
  createLabTestPackageSchema,
  getLabTestPackagesQuerySchema,
  labTestPackageIdParamSchema,
  updateLabTestPackageSchema,
} from '../../schemas/labTestPackages.schemas';

const labTestPackagesRouter = Router();

labTestPackagesRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labTestPackagesRouter.post(
  '/',
  validate(createLabTestPackageSchema, 'body'),
  createLabTestPackageController
);

labTestPackagesRouter.get(
  '/',
  validate(getLabTestPackagesQuerySchema, 'query'),
  getLabTestPackagesController
);

labTestPackagesRouter.get(
  '/:packageId',
  validate(labTestPackageIdParamSchema, 'params'),
  getLabTestPackageByIdController
);

labTestPackagesRouter.put(
  '/:packageId',
  validate(labTestPackageIdParamSchema, 'params'),
  validate(updateLabTestPackageSchema, 'body'),
  updateLabTestPackageController
);

export default labTestPackagesRouter;
