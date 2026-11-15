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
  createLabDepartmentController,
  getLabDepartmentByIdController,
  getLabDepartmentsController,
  getLabDefaultDepartmentsController,
  updateLabDepartmentController,
} from '../../controllers/labDepartment.controller';
import {
  createLabDepartmentSchema,
  getLabDepartmentsQuerySchema,
  labDepartmentIdParamSchema,
  updateLabDepartmentSchema,
} from '../../schemas/labDepartment.schemas';

const labDepartmentRouter = Router();

labDepartmentRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labDepartmentRouter.post(
  '/',
  validate(createLabDepartmentSchema, 'body'),
  createLabDepartmentController
);

labDepartmentRouter.get(
  '/',
  validate(getLabDepartmentsQuerySchema, 'query'),
  getLabDepartmentsController
);

labDepartmentRouter.get('/departments', getLabDefaultDepartmentsController);

labDepartmentRouter.get(
  '/:departmentId',
  validate(labDepartmentIdParamSchema, 'params'),
  getLabDepartmentByIdController
);

labDepartmentRouter.put(
  '/:departmentId',
  validate(labDepartmentIdParamSchema, 'params'),
  validate(updateLabDepartmentSchema, 'body'),
  updateLabDepartmentController
);

export default labDepartmentRouter;
