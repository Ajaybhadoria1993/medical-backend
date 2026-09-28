// src/main/dashboard/routes/v1/dashboard.route.ts
import express from 'express';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  requireAdmin,
  requireAuth,
  requireClinic,
  requireRole,
  requireSuperAdmin,
  enforceClinicAutoLogout,
} from '../../../../middlewear/auth.middleware';
import {
  getDashboardController,
  getDoctorDashboardController,
  getSuperAdminDashboardController,
  getRevenueOverviewController,
  getTodayOverviewController,
  getReceptionOverviewController,
  getReceptionTodayStatsController,
  getSuperAdminRevenueOverviewController,
  getSuperAdminRevenueByPlanController,
  getSuperAdminRevenueAnalyticsController,
  getSuperAdminTopPerformingClinicsController,
  getSuperAdminRegistrationTrendsController,
  getSuperAdminUsersSubscriptionsSummaryController,
} from '../../controllers/dashboard.controller';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  dashboardDoctorQuerySchema,
  dashboardQuerySchema,
  receptionOverviewQuerySchema,
  revenueOverviewQuerySchema,
  superAdminDashboardQuerySchema,
  todayOverviewQuerySchema,
  superAdminRevenueQuerySchema,
} from '../../schemas/dashboard.schemas';
import {
  enforceDateLimit,
  FEATURE_KEYS,
} from '../../../../middlewear/limitation.middleware';

const dashboardRouter = express.Router();

/**
 * @route GET /api/v1/dashboard/
 * @desc Get clinic dashboard statistics
 * @access Private (Admin, Clinic)
 */
dashboardRouter.get(
  '/',
  requireAuth,
  requireAdmin,
  requireClinic,
  enforceClinicAutoLogout,
  validate(dashboardQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  getDashboardController
);

/**
 * @route GET /api/v1/dashboard/doctor
 * @desc Get doctor dashboard statistics
 * @access Private (Doctor, Admin — Admin can pass ?doctorId to view another doctor's data)
 */
dashboardRouter.get(
  '/doctor',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(dashboardDoctorQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  getDoctorDashboardController
);

/**
 * @route GET /api/v1/dashboard/revenue-overview
 * @desc Get revenue overview (this month & this week)
 * @access Private (Admin sees all or specific doctor; Doctor sees only own)
 */
dashboardRouter.get(
  '/revenue-overview',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(revenueOverviewQuerySchema, 'query'),
  getRevenueOverviewController
);

/**
 * @route GET /api/v1/dashboard/today-overview
 * @desc Get today's revenue + appointment stats for a doctor
 * @access Private (Doctor sees own; Admin with doctor access can pass doctorId)
 */
dashboardRouter.get(
  '/today-overview',
  requireAuth,
  requireRole(['Admin', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(todayOverviewQuerySchema, 'query'),
  getTodayOverviewController
);

/**
 * @route GET /api/v1/dashboard/reception
 * @desc Get clinic-wide reception overview for today (appointment counts, payments, new patients, doctor queues)
 * @access Private (Receptionist, Admin)
 */
dashboardRouter.get(
  '/reception',
  requireAuth,
  requireRole(['Receptionist', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(receptionOverviewQuerySchema, 'query'),
  getReceptionOverviewController
);

/**
 * @route GET /api/v1/dashboard/reception/today-stats
 * @desc Get today's receptionist stats (appointment totals, queue waiting,
 *       active doctors, pending payments, clinic day-progress)
 * @access Private (Receptionist, Admin)
 */
dashboardRouter.get(
  '/reception/today-stats',
  requireAuth,
  requireRole(['Receptionist', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  getReceptionTodayStatsController
);

/**
 * @route GET /api/v1/dashboard/super-admin
 * @desc Get super admin dashboard statistics
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminDashboardQuerySchema, 'query'),
  getSuperAdminDashboardController
);

/**
 * @route GET /api/v1/dashboard/super-admin/revenue-overview
 * @desc Get super admin dashboard revenue overview
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/revenue-overview',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminRevenueQuerySchema, 'query'),
  getSuperAdminRevenueOverviewController
);

/**
 * @route GET /api/v1/dashboard/super-admin/revenue-by-plan
 * @desc Get super admin dashboard revenue by plan
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/revenue-by-plan',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminRevenueQuerySchema, 'query'),
  getSuperAdminRevenueByPlanController
);

/**
 * @route GET /api/v1/dashboard/super-admin/revenue-analytics
 * @desc Get super admin dashboard revenue analytics
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/revenue-analytics',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminRevenueQuerySchema, 'query'),
  getSuperAdminRevenueAnalyticsController
);

/**
 * @route GET /api/v1/dashboard/super-admin/top-performing-clinics
 * @desc Get super admin dashboard top performing clinics
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/top-performing-clinics',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminRevenueQuerySchema, 'query'),
  getSuperAdminTopPerformingClinicsController
);

/**
 * @route GET /api/v1/dashboard/super-admin/registration-trends
 * @desc Get super admin dashboard clinic registration trends
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/registration-trends',
  requireAuth,
  requireSuperAdmin,
  validate(superAdminRevenueQuerySchema, 'query'),
  getSuperAdminRegistrationTrendsController
);

/**
 * @route GET /api/v1/dashboard/super-admin/users-subscriptions-summary
 * @desc Get super admin dashboard users by role and subscriptions by plan summary
 * @access Private (Super Admin only)
 */
dashboardRouter.get(
  '/super-admin/users-subscriptions-summary',
  requireAuth,
  requireSuperAdmin,
  getSuperAdminUsersSubscriptionsSummaryController
);

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/doctor',
  description: 'get doctor dashboard',
  query: dashboardDoctorQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard',
  description: 'get dashboard',
  query: dashboardQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/patients',
  description: 'get dashboard',
  query: dashboardQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/revenue-overview',
  description: 'get revenue overview for this month and this week',
  query: revenueOverviewQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/today-overview',
  description: "get today's revenue and appointment stats for a doctor",
  query: todayOverviewQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/reception',
  description:
    "get today's reception overview (appointment counts, payments, new patients, doctor queues)",
  query: receptionOverviewQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/reception/today-stats',
  description:
    "get today's receptionist stats (appointment totals, queue waiting, active doctors, pending payments, clinic day-progress)",
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin',
  description: 'get super admin dashboard with system-wide analytics',
  query: superAdminDashboardQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/revenue-overview',
  description: 'get super admin dashboard revenue overview',
  query: superAdminRevenueQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/revenue-by-plan',
  description: 'get super admin dashboard revenue by plan',
  query: superAdminRevenueQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/revenue-analytics',
  description: 'get super admin dashboard revenue analytics',
  query: superAdminRevenueQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/top-performing-clinics',
  description: 'get super admin dashboard top performing clinics',
  query: superAdminRevenueQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/registration-trends',
  description: 'get super admin dashboard registration trends',
  query: superAdminRevenueQuerySchema,
  tags: ['dashboard'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/dashboard/super-admin/users-subscriptions-summary',
  description:
    'get super admin dashboard users by role and subscription plans summary',
  tags: ['dashboard'],
});

export default dashboardRouter;
