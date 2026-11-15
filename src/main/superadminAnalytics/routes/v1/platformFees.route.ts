import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getPlatformFeesController,
  platformFeeHistoryController,
  previewPlatformFeeController,
  resetClinicFeesController,
  savePlatformFeeController,
} from '../../controllers/platformFees.controller';
import {
  platformFeeClinicParamsSchema,
  platformFeePreviewSchema,
  platformFeeSaveSchema,
  platformFeesQuerySchema,
} from '../../schemas/platformFees.schema';

// Mounted at /api/v1/superadmin-analytics/platform-fees; every route checks Super Admin itself.
const platformFeesRouter = express.Router();

/** @route GET /api/v1/superadmin-analytics/platform-fees — default fees, or one clinic's (?clinicId) */
platformFeesRouter.get(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(platformFeesQuerySchema, 'query'),
  getPlatformFeesController
);

/** @route PUT /api/v1/superadmin-analytics/platform-fees — save one fee as a new version */
platformFeesRouter.put(
  '/',
  requireAuth,
  requireSuperAdmin,
  validate(platformFeeSaveSchema),
  savePlatformFeeController
);

/** @route POST /api/v1/superadmin-analytics/platform-fees/preview — patient total now and with a change */
platformFeesRouter.post(
  '/preview',
  requireAuth,
  requireSuperAdmin,
  validate(platformFeePreviewSchema),
  previewPlatformFeeController
);

/** @route GET /api/v1/superadmin-analytics/platform-fees/history — saved versions (?clinicId) */
platformFeesRouter.get(
  '/history',
  requireAuth,
  requireSuperAdmin,
  validate(platformFeesQuerySchema, 'query'),
  platformFeeHistoryController
);

/** @route DELETE /api/v1/superadmin-analytics/platform-fees/clinics/:clinicId — clinic back to default fees */
platformFeesRouter.delete(
  '/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(platformFeeClinicParamsSchema, 'params'),
  resetClinicFeesController
);

export default platformFeesRouter;

const base = '/api/v1/superadmin-analytics/platform-fees';
for (const [method, path, description] of [
  [
    'get',
    base,
    "Default platform fees, or one clinic's, with limits (Super Admin)",
  ],
  ['put', base, 'Save one platform fee as a new version (Super Admin)'],
  [
    'post',
    `${base}/preview`,
    'Patient total now and with a proposed fee change (Super Admin)',
  ],
  [
    'get',
    `${base}/history`,
    'Saved platform fee versions with who saved them (Super Admin)',
  ],
  [
    'delete',
    `${base}/clinics/:clinicId`,
    'Put a clinic back on the default fees (Super Admin)',
  ],
] as const)
  docsRegistry.addEndpoint({ method, path, description, tags: ['superadmin'] });
