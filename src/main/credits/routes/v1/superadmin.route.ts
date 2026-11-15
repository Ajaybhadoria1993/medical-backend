import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  changeCreditSettingsController,
  createCreditPackController,
  getCreditPacksController,
  updateCreditPackController,
  getClinicCreditsController,
  getCostReportController,
  getCreditSettingsController,
  getCreditSettingsHistoryController,
  grantClinicCreditsController,
  removeClinicCreditsController,
} from '../../controllers/superadmin.controller';
import {
  clinicParamSchema,
  costReportQuerySchema,
  creditChangeSchema,
  creditTypeParamSchema,
  grantsQuerySchema,
  historyQuerySchema,
  packCreateSchema,
  packParamSchema,
  packUpdateSchema,
  settingsChangeSchema,
} from '../../schemas/credits.schema';

// Mounted at /api/v1/credits/superadmin; cross-clinic, so Super Admin only.
const superadminCreditsRouter = express.Router();

/** @route GET /api/v1/credits/superadmin/settings/:creditType — settings in force and any scheduled change
 *  @access Super_Admin */
superadminCreditsRouter.get(
  '/settings/:creditType',
  requireAuth,
  requireSuperAdmin,
  validate(creditTypeParamSchema, 'params'),
  getCreditSettingsController
);

/** @route GET /api/v1/credits/superadmin/settings/:creditType/history — every settings version, who and why
 *  @access Super_Admin */
superadminCreditsRouter.get(
  '/settings/:creditType/history',
  requireAuth,
  requireSuperAdmin,
  validate(creditTypeParamSchema, 'params'),
  validate(historyQuerySchema, 'query'),
  getCreditSettingsHistoryController
);

/** @route POST /api/v1/credits/superadmin/settings/:creditType — new settings version (reason required)
 *  @access Super_Admin */
superadminCreditsRouter.post(
  '/settings/:creditType',
  requireAuth,
  requireSuperAdmin,
  validate(creditTypeParamSchema, 'params'),
  validate(settingsChangeSchema, 'body'),
  changeCreditSettingsController
);

/** @route GET /api/v1/credits/superadmin/clinics/:clinicId — a clinic's balance and credit history
 *  @access Super_Admin */
superadminCreditsRouter.get(
  '/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(grantsQuerySchema, 'query'),
  getClinicCreditsController
);

/** @route POST /api/v1/credits/superadmin/clinics/:clinicId/grant — add credits to a clinic (reason required)
 *  @access Super_Admin */
superadminCreditsRouter.post(
  '/clinics/:clinicId/grant',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(creditChangeSchema, 'body'),
  grantClinicCreditsController
);

/** @route POST /api/v1/credits/superadmin/clinics/:clinicId/remove — remove credits, soonest-expiring first
 *  @access Super_Admin */
superadminCreditsRouter.post(
  '/clinics/:clinicId/remove',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(creditChangeSchema, 'body'),
  removeClinicCreditsController
);

/** @route GET /api/v1/credits/superadmin/packs/:creditType — every pack, switched-off ones included
 *  @access Super_Admin */
superadminCreditsRouter.get(
  '/packs/:creditType',
  requireAuth,
  requireSuperAdmin,
  validate(creditTypeParamSchema, 'params'),
  getCreditPacksController
);

/** @route POST /api/v1/credits/superadmin/packs/:creditType — add a pack (reason required)
 *  @access Super_Admin */
superadminCreditsRouter.post(
  '/packs/:creditType',
  requireAuth,
  requireSuperAdmin,
  validate(creditTypeParamSchema, 'params'),
  validate(packCreateSchema, 'body'),
  createCreditPackController
);

/** @route PATCH /api/v1/credits/superadmin/packs/:creditType/:packId — edit or switch a pack on/off
 *  @access Super_Admin */
superadminCreditsRouter.patch(
  '/packs/:creditType/:packId',
  requireAuth,
  requireSuperAdmin,
  validate(packParamSchema, 'params'),
  validate(packUpdateSchema, 'body'),
  updateCreditPackController
);

/** @route GET /api/v1/credits/superadmin/cost-report — messages and Meta cost per clinic for IST dates
 *  @access Super_Admin */
superadminCreditsRouter.get(
  '/cost-report',
  requireAuth,
  requireSuperAdmin,
  validate(costReportQuerySchema, 'query'),
  getCostReportController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/superadmin/settings/{creditType}',
  description: 'Settings in force and any scheduled change (Super_Admin)',
  params: creditTypeParamSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/superadmin/settings/{creditType}/history',
  description:
    'Every settings version with who and why, paginated (Super_Admin)',
  params: creditTypeParamSchema,
  query: historyQuerySchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/credits/superadmin/settings/{creditType}',
  description:
    'Add a settings version (now or scheduled); reason required (Super_Admin)',
  params: creditTypeParamSchema,
  requestSchema: settingsChangeSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/superadmin/clinics/{clinicId}',
  description:
    "A clinic's balance, next expiry and credit history (Super_Admin)",
  params: clinicParamSchema,
  query: grantsQuerySchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/credits/superadmin/clinics/{clinicId}/grant',
  description: 'Add credits to a clinic; reason required (Super_Admin)',
  params: clinicParamSchema,
  requestSchema: creditChangeSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/credits/superadmin/clinics/{clinicId}/remove',
  description:
    'Remove credits, soonest-expiring first; 409 below zero (Super_Admin)',
  params: clinicParamSchema,
  requestSchema: creditChangeSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/superadmin/cost-report',
  description:
    'Messages and real Meta cost per clinic for IST dates, plus plans with no limit set (Super_Admin)',
  query: costReportQuerySchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/credits/superadmin/packs/{creditType}',
  description: 'Every credit pack, switched-off ones included (Super_Admin)',
  params: creditTypeParamSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/credits/superadmin/packs/{creditType}',
  description:
    'Add a credit pack; 409 if that size exists; reason required (Super_Admin)',
  params: creditTypeParamSchema,
  requestSchema: packCreateSchema,
  tags: ['credits'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/credits/superadmin/packs/{creditType}/{packId}',
  description: 'Edit a pack or switch it on/off; reason required (Super_Admin)',
  params: packParamSchema,
  requestSchema: packUpdateSchema,
  tags: ['credits'],
});

export default superadminCreditsRouter;
