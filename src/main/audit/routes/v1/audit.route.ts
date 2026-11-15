import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import { getClinicAuditLogController } from '../../controllers/auditLog.controller';
import {
  auditClinicParamSchema,
  auditLogQuerySchema,
} from '../../schemas/auditLog.schema';

const auditRouter = express.Router();

/**
 * @route GET /api/v1/audit/clinics/:clinicId
 * @access Private (Super_Admin)
 */
auditRouter.get(
  '/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(auditClinicParamSchema, 'params'),
  validate(auditLogQuerySchema, 'query'),
  getClinicAuditLogController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/audit/clinics/{clinicId}',
  description:
    "A clinic's audit log, newest first, with counts by type (Super_Admin)",
  params: auditClinicParamSchema,
  query: auditLogQuerySchema,
  tags: ['audit'],
});

export default auditRouter;
