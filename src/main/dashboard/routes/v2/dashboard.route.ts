// src/main/dashboard/routes/v2/dashboard.route.ts
import express from 'express';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  requireAuth,
  requireClinic,
  requireRole,
  enforceClinicAutoLogout,
} from '../../../../middlewear/auth.middleware';
import {
  getDoctorDashboardV2Controller,
  getDoctorDashboardProfileController,
} from '../../controllers/dashboard.controller';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  dashboardDoctorQuerySchema,
  todayOverviewQuerySchema,
} from '../../schemas/dashboard.schemas';
import {
  enforceDateLimit,
  FEATURE_KEYS,
} from '../../../../middlewear/limitation.middleware';

const dashboardRouterV2 = express.Router();

/**
 * @route GET /api/v2/dashboard/doctor
 * @desc Get doctor dashboard statistics (v2: accurate completed/waiting/remaining
 *       counts, real setupProgress, cached 45s)
 * @access Private (Doctor, Admin — Admin can pass ?doctorId to view another doctor's data)
 */
dashboardRouterV2.get(
  '/doctor',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(dashboardDoctorQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  getDoctorDashboardV2Controller
);

/**
 * @route GET /api/v2/dashboard/doctor/profile
 * @desc Get doctor dashboard "profile" slice (doctorName + onboarding setupProgress).
 *       Split from /doctor because this data changes rarely and shouldn't share
 *       the volatile stats' 45s cache/invalidation.
 * @access Private (Doctor, Admin — Admin can pass ?doctorId to view another doctor's data)
 */
dashboardRouterV2.get(
  '/doctor/profile',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(todayOverviewQuerySchema, 'query'),
  getDoctorDashboardProfileController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v2/dashboard/doctor/profile',
  description:
    'get doctor dashboard profile slice (doctorName + setupProgress), long-cached',
  query: todayOverviewQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v2/dashboard/doctor',
  description:
    'get doctor dashboard (v2: accurate completed/waiting/remaining counts, real setupProgress, cached)',
  query: dashboardDoctorQuerySchema,
  tags: ['dashboard'],
});

export default dashboardRouterV2;
