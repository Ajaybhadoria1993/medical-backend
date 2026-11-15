import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { strictRateLimit } from '../../../../middlewear/rateLimit.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  endAllSupportSessionsController,
  listClinicSupportSessionsController,
  startSupportSessionController,
} from '../../controllers/superadmin.controller';
import {
  clinicParamSchema,
  sessionsQuerySchema,
  startSupportSessionSchema,
} from '../../schemas/supportAccess.schema';

// Mounted at /api/v1/support-access/superadmin; cross-clinic, so Super Admin only.
const superadminSupportAccessRouter = express.Router();

/** @route POST /api/v1/support-access/superadmin/sessions — start a read-only "View as" session
 *  @access Super_Admin (ends their previous session) */
superadminSupportAccessRouter.post(
  '/sessions',
  requireAuth,
  requireSuperAdmin,
  strictRateLimit,
  validate(startSupportSessionSchema),
  startSupportSessionController
);

/** @route POST /api/v1/support-access/superadmin/sessions/end-all — end every open session of the caller
 *  @access Super_Admin */
superadminSupportAccessRouter.post(
  '/sessions/end-all',
  requireAuth,
  requireSuperAdmin,
  endAllSupportSessionsController
);

/** @route GET /api/v1/support-access/superadmin/clinics/:clinicId/sessions — who viewed this clinic, when, why
 *  @access Super_Admin */
superadminSupportAccessRouter.get(
  '/clinics/:clinicId/sessions',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(sessionsQuerySchema, 'query'),
  listClinicSupportSessionsController
);

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/support-access/superadmin/sessions',
  description:
    'Start a 30-minute read-only, masked "View as" session for one clinic staff member (Super_Admin)',
  requestSchema: startSupportSessionSchema,
  tags: ['support-access'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/support-access/superadmin/sessions/end-all',
  description: "End all of the caller's open View as sessions (Super_Admin)",
  tags: ['support-access'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/support-access/superadmin/clinics/{clinicId}/sessions',
  description:
    'View as history for a clinic: who, as whom, why, when, pages viewed (Super_Admin)',
  params: clinicParamSchema,
  query: sessionsQuerySchema,
  tags: ['support-access'],
});

export default superadminSupportAccessRouter;
