// src/main/subscription/routes/v1/limitations.route.ts
import express from 'express';
import {
  requireAdmin,
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  checkFeatureLimit,
  enforceStaffLimits,
  getClinicLimitsOverview,
  getCloudStorageOverview,
  getPaymentHistoryRetention,
  getStorageRetention,
  reactivateStaff,
} from '../../controllers/limitation.controller';

const limitationsRouter = express.Router();

/**
 * @route GET /api/v1/subscription/limitations/overview
 * @desc Get all plan limits and current usage for the clinic
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/overview',
  requireAuth,
  requireClinic,
  getClinicLimitsOverview
);

/**
 * @route GET /api/v1/subscription/limitations/storage
 * @desc Get cloud storage capacity, usage, and allowed categories
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/storage',
  requireAuth,
  requireClinic,
  getCloudStorageOverview
);

/**
 * @route GET /api/v1/subscription/limitations/check/:featureKey
 * @desc Check if a specific feature is available/within limits
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/check/:featureKey',
  requireAuth,
  requireClinic,
  checkFeatureLimit
);

/**
 * @route GET /api/v1/subscription/limitations/storage-retention
 * @desc Get storage retention months for the clinic's plan
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/storage-retention',
  requireAuth,
  requireClinic,
  getStorageRetention
);

/**
 * @route GET /api/v1/subscription/limitations/payment-history-retention
 * @desc Get payment history retention months for the clinic's plan
 * @access Private (Authenticated + Clinic)
 */
limitationsRouter.get(
  '/payment-history-retention',
  requireAuth,
  requireClinic,
  getPaymentHistoryRetention
);

/**
 * @route POST /api/v1/subscription/limitations/enforce-staff-limits
 * @desc Enforce staff limits — deactivates excess staff/doctors when plan expires
 * @access Private (Super Admin or Clinic Admin)
 */
limitationsRouter.post(
  '/enforce-staff-limits',
  requireAuth,
  requireAdmin,
  requireClinic,
  enforceStaffLimits
);

/**
 * @route POST /api/v1/subscription/limitations/reactivate-staff
 * @desc Reactivate previously deactivated staff after plan upgrade
 * @access Private (Clinic Admin)
 */
limitationsRouter.post(
  '/reactivate-staff',
  requireAuth,
  requireAdmin,
  requireClinic,
  reactivateStaff
);

export default limitationsRouter;

// API Documentation
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/limitations/overview',
  description: 'Get all plan limits and current usage for the clinic',
  tags: ['limitations', 'plan'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/limitations/check/:featureKey',
  description: 'Check if a specific feature is available or within limits',
  tags: ['limitations', 'check'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/limitations/storage-retention',
  description: 'Get storage retention months for the clinic plan',
  tags: ['limitations', 'storage'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/subscription/limitations/payment-history-retention',
  description: 'Get payment history retention months for the clinic plan',
  tags: ['limitations', 'payment'],
});
