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
  createLabTestController,
  getLabTestByIdController,
  getLabTestsController,
  updateLabTestController,
} from '../../controllers/labTests.controller';
import {
  createLabTestSchema,
  getLabTestsQuerySchema,
  labTestIdParamSchema,
  updateLabTestSchema,
} from '../../schemas/labTests.schemas';

const labTestsRouter = Router();

labTestsRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labTestsRouter.post(
  '/',
  validate(createLabTestSchema, 'body'),
  createLabTestController
);

labTestsRouter.get(
  '/',
  validate(getLabTestsQuerySchema, 'query'),
  getLabTestsController
);

labTestsRouter.get(
  '/:testId',
  validate(labTestIdParamSchema, 'params'),
  getLabTestByIdController
);

labTestsRouter.put(
  '/:testId',
  validate(labTestIdParamSchema, 'params'),
  validate(updateLabTestSchema, 'body'),
  updateLabTestController
);

export default labTestsRouter;
