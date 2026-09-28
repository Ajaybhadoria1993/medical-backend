// src/main/subscription/routes/v1/planLimits.route.ts
import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  getAllPlanLimits,
  getPlanLimitsById,
  updatePlanLimits,
  updateSinglePlanLimit,
} from '../../controllers/planLimits.controller';

const planLimitsRouter = express.Router();

/**
 * @route GET /api/v1/subscription/plan-limits/
 * @desc Get all plan limits grouped by plan
 * @access Private (Super Admin)
 */
planLimitsRouter.get('/', requireAuth, requireSuperAdmin, getAllPlanLimits);

/**
 * @route GET /api/v1/subscription/plan-limits/:planId
 * @desc Get limits for a specific plan
 * @access Private (Super Admin)
 */
planLimitsRouter.get(
  '/:planId',
  requireAuth,
  requireSuperAdmin,
  getPlanLimitsById
);

/**
 * @route PUT /api/v1/subscription/plan-limits/:planId
 * @desc Update limits for a plan (bulk upsert)
 * @access Private (Super Admin)
 *
 * Body: { limits: [{ featureKey, limitValue, isUnlimited, enabled, description }] }
 */
planLimitsRouter.put(
  '/:planId',
  requireAuth,
  requireSuperAdmin,
  updatePlanLimits
);

/**
 * @route PATCH /api/v1/subscription/plan-limits/:planId/:featureKey
 * @desc Update a single limit for a plan
 * @access Private (Super Admin)
 *
 * Body: { limitValue?, isUnlimited?, enabled?, description? }
 */
planLimitsRouter.patch(
  '/:planId/:featureKey',
  requireAuth,
  requireSuperAdmin,
  updateSinglePlanLimit
);

export default planLimitsRouter;

// API Documentation
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/plan-limits',
  description: 'Get all plan limits grouped by plan (Super Admin)',
  tags: ['plan-limits', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/plan-limits/:planId',
  description: 'Get limits for a specific plan (Super Admin)',
  tags: ['plan-limits', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/subscription/plan-limits/:planId',
  description: 'Bulk update limits for a plan (Super Admin)',
  tags: ['plan-limits', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/subscription/plan-limits/:planId/:featureKey',
  description: 'Update a single feature limit for a plan (Super Admin)',
  tags: ['plan-limits', 'super-admin'],
});
