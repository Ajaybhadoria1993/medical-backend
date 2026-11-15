import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../apiDocs';
import {
  getClinicSummaryController,
  getClinicTimelineController,
  getGrowthController,
  getUsageController,
  getOverviewController,
  getPatientAppController,
  getRevenueController,
  listAuditController,
  listClinicsController,
  listSessionsController,
  signOutUserController,
} from '../../controllers/superadminAnalytics.controller';
import {
  auditQuerySchema,
  clinicListQuerySchema,
  clinicParamSchema,
  periodQuerySchema,
  sessionsQuerySchema,
  userParamSchema,
} from '../../schemas/superadminAnalytics.schema';

const superadminAnalyticsRouter = express.Router();

// Every route is platform-wide (all clinics), so each one is Super Admin only.
superadminAnalyticsRouter.get(
  '/overview',
  requireAuth,
  requireSuperAdmin,
  validate(periodQuerySchema, 'query'),
  getOverviewController
);

superadminAnalyticsRouter.get(
  '/revenue',
  requireAuth,
  requireSuperAdmin,
  validate(periodQuerySchema, 'query'),
  getRevenueController
);

superadminAnalyticsRouter.get(
  '/growth',
  requireAuth,
  requireSuperAdmin,
  validate(periodQuerySchema, 'query'),
  getGrowthController
);

superadminAnalyticsRouter.get(
  '/patient-app',
  requireAuth,
  requireSuperAdmin,
  validate(periodQuerySchema, 'query'),
  getPatientAppController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/patient-app',
  description:
    'Patient mobile app adoption: signed in on app (Android/iOS), push enabled, app sign-ins, app bookings and share; counts only (Super_Admin)',
  query: periodQuerySchema,
  tags: ['superadmin-analytics'],
});

superadminAnalyticsRouter.get(
  '/audit',
  requireAuth,
  requireSuperAdmin,
  validate(auditQuerySchema, 'query'),
  listAuditController
);

superadminAnalyticsRouter.get(
  '/sessions',
  requireAuth,
  requireSuperAdmin,
  validate(sessionsQuerySchema, 'query'),
  listSessionsController
);

// Ends a staff member's sessions on every device immediately (password-change cut-off).
superadminAnalyticsRouter.post(
  '/sessions/:userId/sign-out',
  requireAuth,
  requireSuperAdmin,
  validate(userParamSchema, 'params'),
  signOutUserController
);

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/superadmin-analytics/sessions/{userId}/sign-out',
  description:
    'Sign a clinic staff member out of all devices now: deletes their sessions and rejects tokens issued earlier (Super_Admin)',
  params: userParamSchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/audit',
  description:
    'Tracked staff actions across all clinics (ids and names only); filter by clinic, action type, role, dates (Super_Admin)',
  query: auditQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/sessions',
  description:
    'Signed-in staff devices (web/app, device, IP, signed in, expiry); patients excluded, never tokens (Super_Admin)',
  query: sessionsQuerySchema,
  tags: ['superadmin-analytics'],
});

superadminAnalyticsRouter.get(
  '/usage',
  requireAuth,
  requireSuperAdmin,
  validate(periodQuerySchema, 'query'),
  getUsageController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/usage',
  description:
    'Usage: appointments per day, by status and booking source, busiest clinics, new patients, staff actions by role; counts only (Super_Admin)',
  query: periodQuerySchema,
  tags: ['superadmin-analytics'],
});

superadminAnalyticsRouter.get(
  '/clinics',
  requireAuth,
  requireSuperAdmin,
  validate(clinicListQuerySchema, 'query'),
  listClinicsController
);

superadminAnalyticsRouter.get(
  '/clinics/:clinicId',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  getClinicSummaryController
);

superadminAnalyticsRouter.get(
  '/clinics/:clinicId/timeline',
  requireAuth,
  requireSuperAdmin,
  validate(clinicParamSchema, 'params'),
  getClinicTimelineController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/clinics/{clinicId}/timeline',
  description:
    "One clinic's subscription events and Action Center history, newest first, max 100 (Super_Admin)",
  params: clinicParamSchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/overview',
  description:
    'Business overview: MRR + bridge, paid/active clinics, registrations, Free/Trial → Paid, funnel, stages (Super_Admin)',
  query: periodQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/revenue',
  description:
    'Revenue: MRR, ARPC, MRR bridge + movement counts, collected money (subscriptions + booking fees), plan mix, failed payments (Super_Admin)',
  query: periodQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/growth',
  description:
    'Growth: registrations, cohort funnel, setup / First Value rates, Free/Trial → Paid, time to First Value, acquisition sources (Super_Admin)',
  query: periodQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/clinics',
  description:
    'Clinic list with stage, billing and MRR; search by name, MED-ID, phone or city (Super_Admin)',
  query: clinicListQuerySchema,
  tags: ['superadmin-analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/superadmin-analytics/clinics/{clinicId}',
  description: "One clinic's business summary for Clinic 360° (Super_Admin)",
  params: clinicParamSchema,
  tags: ['superadmin-analytics'],
});

export default superadminAnalyticsRouter;
