import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  requireAuth,
  requireClinic,
  requireRole,
  requireReceptionist,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  createPharmacyController,
  assignPharmacyUserController,
  createPharmacyUserController,
  createPharmacyMemberController,
  getPharmacyByIdWithUsersController,
  getAllPharmaciesController,
  updatePharmacyStatusController,
  deletePharmacyController,
  updatePharmacyController,
} from '../../controllers/pharmacy.controller';
import {
  assignPharmacyUserSchema,
  createPharmacySchema,
  createPharmacyUserSchema,
  createPharmacyMemberSchema,
  getPharmacyByIdParamsSchema,
  getPharmacyUsersQuerySchema,
  getPharmaciesQuerySchema,
  updatePharmacyStatusSchema,
  updatePharmacySchema,
} from '../../schemas/pharmacy.schemas';
import { requirePharmacySubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const pharmacyRouter = express.Router();

/**
 * @route POST /api/v1/pharmacy/
 * @desc Create a new pharmacy in the current clinic
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.post(
  '/',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(createPharmacySchema, 'body'),
  createPharmacyController
);

/**
 * @route POST /api/v1/pharmacy/users/assign
 * @desc Assign an existing user to a pharmacy
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.post(
  '/users/assign',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(assignPharmacyUserSchema, 'body'),
  assignPharmacyUserController
);

/**
 * @route PUT /api/v1/pharmacy/:pharmacyId
 * @desc Update pharmacy details
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.put(
  '/:pharmacyId',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(updatePharmacySchema, 'body'),
  updatePharmacyController
);

/**
 * @route POST /api/v1/pharmacy/users
 * @desc Create a new pharmacist user and assign to a pharmacy
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.post(
  '/users',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(createPharmacyUserSchema, 'body'),
  createPharmacyUserController
);

/**
 * @route POST /api/v1/pharmacy/:pharmacyId/member
 * @desc Create a pharmacist member for a specific pharmacy
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.post(
  '/:pharmacyId/member',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(getPharmacyByIdParamsSchema, 'params'),
  validate(createPharmacyMemberSchema, 'body'),
  createPharmacyMemberController
);

/**
 * @route GET /api/v1/pharmacy/all
 * @desc List all pharmacies for the current clinic
 * @access Private (Admin, Super_Admin)
 */
pharmacyRouter.get(
  '/all',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(getPharmaciesQuerySchema, 'query'),
  getAllPharmaciesController
);

// Admin-only: update pharmacy status
pharmacyRouter.put(
  '/:pharmacyId/status',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(getPharmacyByIdParamsSchema, 'params'),
  validate(updatePharmacyStatusSchema, 'body'),
  updatePharmacyStatusController
);

// Admin-only: soft delete pharmacy
pharmacyRouter.delete(
  '/:pharmacyId',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  requirePharmacySubscription,
  validate(getPharmacyByIdParamsSchema, 'params'),
  deletePharmacyController
);

export default pharmacyRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/pharmacy',
  description: 'Create pharmacy (admin only, within clinic)',
  requestSchema: createPharmacySchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/pharmacy/users/assign',
  description: 'Assign existing user to a pharmacy (admin only)',
  requestSchema: assignPharmacyUserSchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/pharmacy/users',
  description: 'Create pharmacist user and assign to a pharmacy',
  requestSchema: createPharmacyUserSchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/pharmacy/:pharmacyId/member',
  description: 'Create pharmacist member in a pharmacy by id',
  params: getPharmacyByIdParamsSchema,
  requestSchema: createPharmacyMemberSchema,
  tags: ['pharmacy'],
});

// GET /api/v1/pharmacy/:pharmacyId — pharmacy with associated users (paginated)
pharmacyRouter.get(
  '/:pharmacyId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  requirePharmacySubscription,
  validate(getPharmacyByIdParamsSchema, 'params'),
  validate(getPharmacyUsersQuerySchema, 'query'),
  getPharmacyByIdWithUsersController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/pharmacy/:pharmacyId',
  description: 'Get pharmacy by id with associated users (paginated)',
  params: getPharmacyByIdParamsSchema,
  query: getPharmacyUsersQuerySchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/pharmacy/all',
  description: 'List all pharmacy details (paginated) for current clinic',
  query: getPharmaciesQuerySchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/pharmacy/:pharmacyId/status',
  description: 'Update pharmacy status (active/deactive)',
  params: getPharmacyByIdParamsSchema,
  requestSchema: updatePharmacyStatusSchema,
  tags: ['pharmacy'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/pharmacy/:pharmacyId',
  description: 'Soft delete pharmacy by id',
  params: getPharmacyByIdParamsSchema,
  tags: ['pharmacy'],
});
