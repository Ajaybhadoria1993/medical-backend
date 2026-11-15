import { Router } from 'express';
import {
  requireAuth,
  requireLab,
  requireLabClinicContext,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getLabBillingSummaryController,
  getLabDashboardCardsController,
  getMostUsedTestsController,
  getLabOrderCountTrendController,
  getLabOrderStatusDistributionController,
} from '../../controllers/labDashboard.controller';
import {
  labDashboardQuerySchema,
  labOrderCountTrendQuerySchema,
} from '../../schemas/labDashboard.schemas';

const labDashboardRouter = Router();

labDashboardRouter.get(
  '/',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(labDashboardQuerySchema, 'query'),
  getLabDashboardCardsController
);

labDashboardRouter.get(
  '/order-status',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(labDashboardQuerySchema, 'query'),
  getLabOrderStatusDistributionController
);

labDashboardRouter.get(
  '/most-used-test',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(labDashboardQuerySchema, 'query'),
  getMostUsedTestsController
);

labDashboardRouter.get(
  '/billing-summary',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(labDashboardQuerySchema, 'query'),
  getLabBillingSummaryController
);

labDashboardRouter.get(
  '/order-counts',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Lab_Assistant', 'Receptionist']),
  requireLab,
  requireLabClinicContext,
  requireFeature(FEATURE_KEYS.LAB_INTEGRATION),
  validate(labOrderCountTrendQuerySchema, 'query'),
  getLabOrderCountTrendController
);

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description:
      'Get lab dashboard cards with previous-period comparisons and billing-history revenue',
    query: labDashboardQuerySchema,
    tags: ['lab-dashboard'],
  },
  {
    method: 'get',
    path: '/order-status',
    description:
      'Get lab order status counts and percentage distribution for a selected date range',
    query: labDashboardQuerySchema,
    tags: ['lab-dashboard'],
  },
  {
    method: 'get',
    path: '/most-used-test',
    description:
      'Get the top five lab tests by individual order count for a selected createdAt date range',
    query: labDashboardQuerySchema,
    tags: ['lab-dashboard'],
  },
  {
    method: 'get',
    path: '/billing-summary',
    description:
      'Get total, Cash, UPI, Card, and other lab billing amounts for a selected date range',
    query: labDashboardQuerySchema,
    tags: ['lab-dashboard'],
  },
  {
    method: 'get',
    path: '/order-counts',
    description:
      'Get daily initiated, processing, and completed lab order counts for this week or month',
    query: labOrderCountTrendQuerySchema,
    tags: ['lab-dashboard'],
  },
];

export default labDashboardRouter;
