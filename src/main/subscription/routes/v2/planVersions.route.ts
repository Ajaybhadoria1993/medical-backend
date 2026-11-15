import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  addPlanFeature,
  createPlan,
  createPlanVersion,
  deletePlanVersion,
  endPlan,
  undoEndPlan,
  listPlanClinics,
  listPlanVersions,
  removePlanFeature,
  renamePlanFeature,
  reorderPlanFeatures,
  setPlanVisibility,
  updatePlanVersion,
} from '../../controllers/v2/planVersions.controller';
import {
  addPlanFeatureSchema,
  createPlanSchema,
  createPlanVersionSchema,
  endPlanSchema,
  planFeatureParamsSchema,
  renamePlanFeatureSchema,
  reorderPlanFeaturesSchema,
  planVersionIdParamsSchema,
  planVersionParamsSchema,
  planVisibilitySchema,
} from '../../schemas/planVersion.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route POST /api/v2/subscription/plan-versions — a new plan with version 1, not sold until put on sale */
router.post('/', validate(createPlanSchema, 'body'), createPlan);

/** @route GET /api/v2/subscription/plan-versions/:planId — versions, newest first, with clinics on each */
router.get(
  '/:planId',
  validate(planVersionParamsSchema, 'params'),
  listPlanVersions
);

/** @route POST /api/v2/subscription/plan-versions/:planId — next version; unsent limits are copied */
router.post(
  '/:planId',
  validate(planVersionParamsSchema, 'params'),
  validate(createPlanVersionSchema, 'body'),
  createPlanVersion
);

/** @route PATCH /api/v2/subscription/plan-versions/:planId/visibility — hide or show a plan */
router.patch(
  '/:planId/visibility',
  validate(planVersionParamsSchema, 'params'),
  validate(planVisibilitySchema, 'body'),
  setPlanVisibility
);

/** @route POST /api/v2/subscription/plan-versions/:planId/end — end the plan; clinics move at their next renewal */
router.post(
  '/:planId/end',
  validate(planVersionParamsSchema, 'params'),
  validate(endPlanSchema, 'body'),
  endPlan
);

/** @route DELETE /api/v2/subscription/plan-versions/:planId/end — undo an end that has not happened */
router.delete(
  '/:planId/end',
  validate(planVersionParamsSchema, 'params'),
  undoEndPlan
);

/** @route GET /api/v2/subscription/plan-versions/:planId/clinics — clinics on the plan now */
router.get(
  '/:planId/clinics',
  validate(planVersionParamsSchema, 'params'),
  listPlanClinics
);

/** @route POST /api/v2/subscription/plan-versions/:planId/features — add a text-only selling point */
router.post(
  '/:planId/features',
  validate(planVersionParamsSchema, 'params'),
  validate(addPlanFeatureSchema, 'body'),
  addPlanFeature
);

/** @route PUT /api/v2/subscription/plan-versions/:planId/features/order — set the display order */
router.put(
  '/:planId/features/order',
  validate(planVersionParamsSchema, 'params'),
  validate(reorderPlanFeaturesSchema, 'body'),
  reorderPlanFeatures
);

/** @route PATCH /api/v2/subscription/plan-versions/:planId/features/:featureKey — change a feature's wording */
router.patch(
  '/:planId/features/:featureKey',
  validate(planFeatureParamsSchema, 'params'),
  validate(renamePlanFeatureSchema, 'body'),
  renamePlanFeature
);

/** @route DELETE /api/v2/subscription/plan-versions/:planId/features/:featureKey — remove a text-only selling point */
router.delete(
  '/:planId/features/:featureKey',
  validate(planFeatureParamsSchema, 'params'),
  removePlanFeature
);

/** @route PATCH /api/v2/subscription/plan-versions/:planId/:versionId — change a scheduled version before it starts */
router.patch(
  '/:planId/:versionId',
  validate(planVersionIdParamsSchema, 'params'),
  validate(createPlanVersionSchema, 'body'),
  updatePlanVersion
);

/** @route DELETE /api/v2/subscription/plan-versions/:planId/:versionId — cancel a scheduled version */
router.delete(
  '/:planId/:versionId',
  validate(planVersionIdParamsSchema, 'params'),
  deletePlanVersion
);

export default router;

export const apiDocs = [
  {
    method: 'post',
    path: '/',
    description:
      'Create a plan with its first version; it starts not sold (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'get',
    path: '/:planId',
    description: 'Plan versions (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'post',
    path: '/:planId',
    description: 'Create a plan version (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'patch',
    path: '/:planId/visibility',
    description: 'Hide or show a plan (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'post',
    path: '/:planId/end',
    description:
      'End a plan; its clinics move to the replacement at their next renewal (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'delete',
    path: '/:planId/end',
    description: 'Undo a plan end that has not happened (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'get',
    path: '/:planId/clinics',
    description: 'Clinics on a plan now (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'post',
    path: '/:planId/features',
    description: 'Add a text-only selling point to a plan (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'put',
    path: '/:planId/features/order',
    description:
      "Set the order of a plan's features on every version (Super Admin)",
    tags: ['subscription', 'plans'],
  },
  {
    method: 'patch',
    path: '/:planId/features/:featureKey',
    description:
      "Change a plan feature's wording on every version (Super Admin)",
    tags: ['subscription', 'plans'],
  },
  {
    method: 'delete',
    path: '/:planId/features/:featureKey',
    description: 'Remove a text-only selling point (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'patch',
    path: '/:planId/:versionId',
    description: 'Change a scheduled version before it starts (Super Admin)',
    tags: ['subscription', 'plans'],
  },
  {
    method: 'delete',
    path: '/:planId/:versionId',
    description: 'Cancel a scheduled version (Super Admin)',
    tags: ['subscription', 'plans'],
  },
];
