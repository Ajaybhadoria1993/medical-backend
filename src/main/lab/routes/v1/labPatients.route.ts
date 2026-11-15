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
import { getLabPatientsController } from '../../controllers/labPatients.controller';
import { getLabPatientsQuerySchema } from '../../schemas/labPatients.schemas';

const labPatientsRouter = Router();

labPatientsRouter.use(
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION)
);

labPatientsRouter.get(
  '/',
  validate(getLabPatientsQuerySchema, 'query'),
  getLabPatientsController
);

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'Get patients found from lab orders for the current lab',
    query: getLabPatientsQuerySchema,
    tags: ['lab-patients'],
  },
];

export default labPatientsRouter;
