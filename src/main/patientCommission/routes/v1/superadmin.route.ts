import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  changeClinicPricingController,
  changeDefaultPricingController,
  getClinicPricingController,
  getDefaultPricingController,
  listClinicPricingController,
} from '../../controllers/superadmin.controller';
import {
  clinicParamSchema,
  clinicPricingChangeSchema,
  defaultPricingChangeSchema,
  historyQuerySchema,
} from '../../schemas/patientCommission.schema';

// Mounted at /api/v1/patient-commission/superadmin; cross-clinic, so Super Admin only.
const superadminPatientCommissionRouter = express.Router();

/** @route GET /api/v1/patient-commission/superadmin/pricing — the platform default: in force, scheduled, history
 *  @access Super_Admin */
superadminPatientCommissionRouter.get(
  '/pricing',
  requireAuth,
  requireSuperAdmin,
  validate(historyQuerySchema, 'query'),
  getDefaultPricingController
);

/** @route POST /api/v1/patient-commission/superadmin/pricing — a new platform default from the next period (reason required)
 *  @access Super_Admin */
superadminPatientCommissionRouter.post(
  '/pricing',
  requireAuth,
  requireSuperAdmin,
  validate(defaultPricingChangeSchema, 'body'),
  changeDefaultPricingController
);

/** @route GET /api/v1/patient-commission/superadmin/pricing/clinics — clinics with pricing of their own
 *  @access Super_Admin */
superadminPatientCommissionRouter.get(
  '/pricing/clinics',
  requireAuth,
  requireSuperAdmin,
  listClinicPricingController
);

/** @route GET /api/v1/patient-commission/superadmin/pricing/clinics/:clinicId — one clinic's pricing and history
 *  @access Super_Admin */
superadminPatientCommissionRouter.get(
  '/pricing/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(historyQuerySchema, 'query'),
  getClinicPricingController
);

/** @route POST /api/v1/patient-commission/superadmin/pricing/clinics/:clinicId — set a clinic's own pricing, or back to the default (reason required)
 *  @access Super_Admin */
superadminPatientCommissionRouter.post(
  '/pricing/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  validate(clinicPricingChangeSchema, 'body'),
  changeClinicPricingController
);

const base = '/api/v1/patient-commission/superadmin/pricing';

docsRegistry.addEndpoint({
  method: 'get',
  path: base,
  description: 'Platform default per-patient pricing: in force, scheduled, history',
  query: historyQuerySchema,
  tags: ['patient-commission', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: base,
  description: 'Save a new platform default from the next billing period',
  requestSchema: defaultPricingChangeSchema,
  tags: ['patient-commission', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: `${base}/clinics`,
  description: 'Clinics with their own per-patient pricing',
  tags: ['patient-commission', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: `${base}/clinics/:clinicId`,
  description: "One clinic's pricing and history",
  params: clinicParamSchema,
  query: historyQuerySchema,
  tags: ['patient-commission', 'super-admin'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: `${base}/clinics/:clinicId`,
  description: "Set a clinic's own pricing, or send it back to the default",
  params: clinicParamSchema,
  requestSchema: clinicPricingChangeSchema,
  tags: ['patient-commission', 'super-admin'],
});

export default superadminPatientCommissionRouter;
