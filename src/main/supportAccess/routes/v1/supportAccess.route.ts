import express from 'express';
import {
  CLINIC_STAFF_ROLES,
  requireAuth,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { endOwnSupportSessionController } from '../../controllers/supportAccess.controller';
import { requireSupportSession } from '../../middlewares/supportSession.middleware';

// Mounted at /api/v1/support-access; called from inside a "View as" tab.
const supportAccessRouter = express.Router();

/** @route POST /api/v1/support-access/session/end — exit the current "View as" session
 *  @access any authenticated user holding a View as token (requireSupportSession) */
supportAccessRouter.post(
  '/session/end',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireSupportSession,
  endOwnSupportSessionController
);

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/support-access/session/end',
  description: 'End the View as session this token belongs to',
  tags: ['support-access'],
});

export default supportAccessRouter;
