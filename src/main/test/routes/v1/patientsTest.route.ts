// src/main/test/routes/v1/patientsTest.route.ts
import { Router } from 'express';
import {
  createTestController,
  deleteTestController,
  getAllTestsController,
  getTestByIdController,
  updateTestController,
} from '../../controllers/patientsTest.controller';
import {
  createTestSchema,
  testIdParamSchema,
  updateTestSchema,
} from '../../schemas/patientsTest.schema';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireAdmin,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';

const testRouter = Router();

/**
 * @route POST /api/v1/test/patients-test/
 * @desc Create a new laboratory test definition
 * @access Private (Admin, Clinic)
 */
testRouter.post(
  '/',
  validate(createTestSchema, 'body'),
  requireAuth,
  requireAdmin,
  requireClinic,
  createTestController
);

/**
 * @route GET /api/v1/test/patients-test/
 * @desc Get all available laboratory test definitions
 * @access Private (Admin)
 */
testRouter.get('/', requireAuth, requireAdmin, getAllTestsController);

/**
 * @route GET /api/v1/test/patients-test/:id
 * @desc Get details of a specific laboratory test definition by ID
 * @access Private (Admin)
 */
testRouter.get(
  '/:id',
  validate(testIdParamSchema, 'params'),
  requireAuth,
  requireAdmin,
  getTestByIdController
);

/**
 * @route PATCH /api/v1/test/patients-test/:id
 * @desc Update an existing laboratory test definition
 * @access Private (Admin)
 */
testRouter.patch(
  '/:id',
  validate(testIdParamSchema, 'params'),
  validate(updateTestSchema, 'body'),
  requireAuth,
  requireClinic,
  requireAdmin,
  updateTestController
);

/**
 * @route DELETE /api/v1/test/patients-test/:id
 * @desc Delete a laboratory test definition
 * @access Private (Admin)
 */
testRouter.delete(
  '/:id',
  validate(testIdParamSchema, 'params'),
  requireAuth,
  requireAdmin,
  deleteTestController
);

// Image upload route - assuming a middleware 'upload' exists or needs to be added
// testRouter.post('/upload-image', upload.single('image'), uploadTestImageController);
// Commented out until multer/upload utility is confirmed.

export default testRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/test/patients-test',
  description: 'Create a new test',
  requestSchema: createTestSchema,
  tags: ['test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/patients-test',
  description: 'Get all tests',
  tags: ['test'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/test/patients-test/:id',
  description: 'Get test by ID',
  params: testIdParamSchema,
  tags: ['test'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/test/patients-test/:id',
  description: 'Update test',
  params: testIdParamSchema,
  requestSchema: updateTestSchema,
  tags: ['test'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/test/patients-test/:id',
  description: 'Delete test',
  params: testIdParamSchema,
  tags: ['test'],
});
