import express from 'express';
import {
  requireAuth,
  requireClinic,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  reportsOverviewQuerySchema,
  reportsOverviewTrendQuerySchema,
} from '../../schemas/reportsOverview.schemas';
import {
  reportsPatientsQuerySchema,
  reportsPatientsTrendQuerySchema,
} from '../../schemas/reportsPatients.schemas';
import {
  reportsAppointmentsQuerySchema,
  reportsAppointmentsTrendQuerySchema,
} from '../../schemas/reportsAppointments.schemas';
import {
  getReportsOverviewController,
  getReportsOverviewTrendController,
} from '../../controllers/reportsOverview.controller';
import {
  getReportsPatientsController,
  getReportsPatientsTrendController,
} from '../../controllers/reportsPatients.controller';
import {
  reportsRevenueQuerySchema,
  reportsRevenueTrendQuerySchema,
} from '../../schemas/reportsRevenue.schemas';
import {
  getReportsAppointmentsController,
  getReportsAppointmentsTrendController,
} from '../../controllers/reportsAppointments.controller';
import {
  reportsMedicinesQuerySchema,
  reportsMedicinesTrendQuerySchema,
} from '../../schemas/reportsMedicines.schemas';
import {
  getReportsRevenueController,
  getReportsRevenueTrendController,
} from '../../controllers/reportsRevenue.controller';
import {
  reportsStaffQuerySchema,
  reportsStaffTrendQuerySchema,
} from '../../schemas/reportsStaff.schemas';
import {
  getReportsMedicinesController,
  getReportsMedicinesTrendController,
} from '../../controllers/reportsMedicines.controller';
import { reportsCustomRunSchema } from '../../schemas/reportsCustom.schemas';
import {
  getReportsStaffController,
  getReportsStaffTrendController,
} from '../../controllers/reportsStaff.controller';
import {
  getReportsCustomSchemaController,
  runReportsCustomController,
} from '../../controllers/reportsCustom.controller';
import { docsRegistry } from '../../../../utils/docsRegistry';

const reportsOverviewRouter = express.Router();

/**
 * @route GET /api/v1/reports-overview
 * @desc Get all reports overview data in a single consolidated response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsOverviewQuerySchema, 'query'),
  getReportsOverviewController
);

/**
 * @route GET /api/v1/reports-overview/trend
 * @desc Get trend chart data for a specific type and period
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsOverviewTrendQuerySchema, 'query'),
  getReportsOverviewTrendController
);

/**
 * @route GET /api/v1/reports-overview/patients
 * @desc Get all patient report data in a single consolidated response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/patients',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsPatientsQuerySchema, 'query'),
  getReportsPatientsController
);

/**
 * @route GET /api/v1/reports-overview/patients/trend
 * @desc Get patient trend chart data for a specific type and period
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/patients/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsPatientsTrendQuerySchema, 'query'),
  getReportsPatientsTrendController
);

/**
 * @route GET /api/v1/reports-overview/appointments
 * @desc Get all appointment report data in a single consolidated response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/appointments',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsAppointmentsQuerySchema, 'query'),
  getReportsAppointmentsController
);

/**
 * @route GET /api/v1/reports-overview/appointments/trend
 * @desc Get appointment trend chart data
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/appointments/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsAppointmentsTrendQuerySchema, 'query'),
  getReportsAppointmentsTrendController
);

/**
 * @route GET /api/v1/reports-overview/revenue
 * @desc Get all revenue report data in a single consolidated response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/revenue',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsRevenueQuerySchema, 'query'),
  getReportsRevenueController
);

/**
 * @route GET /api/v1/reports-overview/revenue/trend
 * @desc Get revenue trend chart data
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/revenue/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsRevenueTrendQuerySchema, 'query'),
  getReportsRevenueTrendController
);

/**
 * @route GET /api/v1/reports-overview/medicines
 * @desc Get all medicine report data in a single consolidated response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/medicines',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsMedicinesQuerySchema, 'query'),
  getReportsMedicinesController
);

/**
 * @route GET /api/v1/reports-overview/medicines/trend
 * @desc Get medicine sales trend chart data
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/medicines/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsMedicinesTrendQuerySchema, 'query'),
  getReportsMedicinesTrendController
);

/**
 * @route GET /api/v1/reports-overview/staff
 * @desc Get staff roster and workload report data in a single response
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/staff',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsStaffQuerySchema, 'query'),
  getReportsStaffController
);

/**
 * @route GET /api/v1/reports-overview/staff/trend
 * @desc Get staff appointment trend chart data
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/staff/trend',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsStaffTrendQuerySchema, 'query'),
  getReportsStaffTrendController
);

/**
 * @route GET /api/v1/reports-overview/custom/schema
 * @desc Catalogue of data sources, metrics, dimensions and filters the custom
 *       report builder may use
 * @access Private (Admin only)
 */
reportsOverviewRouter.get(
  '/custom/schema',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  getReportsCustomSchemaController
);

/**
 * @route POST /api/v1/reports-overview/custom/run
 * @desc Execute a custom report definition
 * @access Private (Admin only)
 */
reportsOverviewRouter.post(
  '/custom/run',
  requireAuth,
  requireRole(['Admin', 'Super_Admin']),
  requireClinic,
  validate(reportsCustomRunSchema, 'body'),
  runReportsCustomController
);

export default reportsOverviewRouter;

// ─── API Documentation ─────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview',
  description:
    'Get all reports overview data (metrics, trends, distributions, alerts) in one call',
  query: reportsOverviewQuerySchema,
  tags: ['Reports Overview', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/trend',
  description:
    'Get trend chart data for appointments or prescriptions with configurable period',
  query: reportsOverviewTrendQuerySchema,
  tags: ['Reports Overview', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/patients',
  description:
    'Get all patient report data (metrics, demographics, trends, growth) in one call',
  query: reportsPatientsQuerySchema,
  tags: ['Reports Patients', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/patients/trend',
  description:
    'Get patient trend chart data for patients or newVsReturning with configurable period',
  query: reportsPatientsTrendQuerySchema,
  tags: ['Reports Patients', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/appointments',
  description:
    'Get all appointment report data (metrics, status, time slots, doctors) in one call',
  query: reportsAppointmentsQuerySchema,
  tags: ['Reports Appointments', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/appointments/trend',
  description:
    'Get appointment trend chart data for appointments, byDay, timeSlots, or doctors',
  query: reportsAppointmentsTrendQuerySchema,
  tags: ['Reports Appointments', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/revenue',
  description:
    'Get all revenue report data (metrics, trend, breakdowns, aging, YTD) in one call',
  query: reportsRevenueQuerySchema,
  tags: ['Reports Revenue', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/revenue/trend',
  description:
    'Get revenue trend chart data for billed or collected revenue with configurable period',
  query: reportsRevenueTrendQuerySchema,
  tags: ['Reports Revenue', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/medicines',
  description:
    'Get all medicine report data (sales, inventory, expiry, suppliers) in one call',
  query: reportsMedicinesQuerySchema,
  tags: ['Reports Medicines', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/medicines/trend',
  description:
    'Get medicine sales trend chart data by amount or units with configurable period',
  query: reportsMedicinesTrendQuerySchema,
  tags: ['Reports Medicines', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/staff',
  description:
    'Get staff roster, role split and per-doctor workload. Attendance, leave and overtime are not tracked in the schema and are reported as unavailable',
  query: reportsStaffQuerySchema,
  tags: ['Reports Staff', 'Analytics'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/reports-overview/staff/trend',
  description:
    'Get staff appointment trend chart data for all or completed appointments',
  query: reportsStaffTrendQuerySchema,
  tags: ['Reports Staff', 'Analytics'],
});
