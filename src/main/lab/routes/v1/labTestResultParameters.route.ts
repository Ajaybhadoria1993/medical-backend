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
  createLabTestResultParameterController,
  getLabTestResultParametersByTestIdController,
  getLabTestResultParametersController,
  updateLabTestResultParameterController,
} from '../../controllers/labTestResultParameters.controller';
import {
  createLabTestResultParameterSchema,
  labTestIdParamSchema,
  labTestResultParameterIdParamSchema,
  updateLabTestResultParameterSchema,
} from '../../schemas/labTestResultParameters.schemas';

const labTestResultParametersRouter = Router();

labTestResultParametersRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labTestResultParametersRouter.post(
  '/',
  validate(createLabTestResultParameterSchema, 'body'),
  createLabTestResultParameterController
);

labTestResultParametersRouter.get('/', getLabTestResultParametersController);

labTestResultParametersRouter.get(
  '/test/:testId',
  validate(labTestIdParamSchema, 'params'),
  getLabTestResultParametersByTestIdController
);

labTestResultParametersRouter.put(
  '/:parameterId',
  validate(labTestResultParameterIdParamSchema, 'params'),
  validate(updateLabTestResultParameterSchema, 'body'),
  updateLabTestResultParameterController
);

export default labTestResultParametersRouter;
