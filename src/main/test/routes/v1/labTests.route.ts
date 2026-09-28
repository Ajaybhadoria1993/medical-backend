// src/main/test/routes/v1/labTests.route.ts
import { Router } from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireClinic,
  requireLab,
  requireLabAssistant,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  createLabTestsSchema,
  labTestsIdParamSchema,
  matchingTestsQuerySchema,
  updateLabTestsSchema,
} from '../../schemas/labTests.schema';
import {
  createLabTestsController,
  deleteLabTestsController,
  getAllLabTestsController,
  getLabTestsByIdController,
  getMatchingTestsController,
  updateLabTestsController,
} from '../../controllers/labTests.controller';

const labTestsRouter = Router();

labTestsRouter.get(
  '/matching-tests',
  validate(matchingTestsQuerySchema, 'query'),
  requireAuth,
  requireClinic,
  requireLabAssistant,
  requireLab,
  getMatchingTestsController
);

labTestsRouter.post(
  '/',
  validate(createLabTestsSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLab,
  createLabTestsController
);

labTestsRouter.get('/', requireAuth, requireLab, getAllLabTestsController);

labTestsRouter.get(
  '/:id',
  validate(labTestsIdParamSchema, 'params'),
  requireAuth,
  requireLab,
  getLabTestsByIdController
);

labTestsRouter.patch(
  '/:id',
  validate(labTestsIdParamSchema, 'params'),
  validate(updateLabTestsSchema, 'body'),
  requireAuth,
  requireClinic,
  requireLab,
  updateLabTestsController
);

labTestsRouter.delete(
  '/:id',
  validate(labTestsIdParamSchema, 'params'),
  requireAuth,
  requireClinic,
  requireLab,
  deleteLabTestsController
);

export default labTestsRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/test/lab-tests',
  description: 'Create a new lab test',
  requestSchema: createLabTestsSchema,
  tags: ['lab-test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/lab-tests',
  description: 'Get all lab tests',
  tags: ['lab-test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/lab-tests/:id',
  description: 'Get lab test by ID',
  params: labTestsIdParamSchema,
  tags: ['lab-test'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/test/lab-tests/:id',
  description: 'Update lab test',
  params: labTestsIdParamSchema,
  requestSchema: updateLabTestsSchema,
  tags: ['lab-test'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/test/lab-tests/:id',
  description: 'Delete lab test',
  params: labTestsIdParamSchema,
  tags: ['lab-test'],
});
