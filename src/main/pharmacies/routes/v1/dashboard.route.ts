import express from 'express';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getAiStockPredictionController,
  getCategoryRevenueController,
  getDashboardSummaryController,
  getDashboardStatsController,
  getSalesOverviewController,
  getSalesChartDataController,
  getTopPerformersController,
  getTopSellingMedicinesController,
  getTopSuppliersController,
} from '../../controllers/dashboard.controller';
import {
  dashboardPeriodQuerySchema,
  dashboardSummaryQuerySchema,
  salesOverviewQuerySchema,
} from '../../schemas/dashboard.schema';
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const dashboardRouter = express.Router();

dashboardRouter.get(
  '/stats',
  requireAuth,
  requireUserSubscription,
  getDashboardStatsController
);

dashboardRouter.get(
  '/sales-chart',
  requireAuth,
  requireUserSubscription,
  getSalesChartDataController
);

dashboardRouter.get(
  '/top-selling-medicines',
  requireAuth,
  requireUserSubscription,
  getTopSellingMedicinesController
);

dashboardRouter.get(
  '/top-suppliers',
  requireAuth,
  requireUserSubscription,
  getTopSuppliersController
);

dashboardRouter.get(
  '/summary',
  requireAuth,
  validate(dashboardSummaryQuerySchema, 'query'),
  requireUserSubscription,
  getDashboardSummaryController
);

dashboardRouter.get(
  '/sales-overview',
  requireAuth,
  validate(salesOverviewQuerySchema, 'query'),
  requireUserSubscription,
  getSalesOverviewController
);

dashboardRouter.get(
  '/category-revenue',
  requireAuth,
  validate(dashboardPeriodQuerySchema, 'query'),
  requireUserSubscription,
  getCategoryRevenueController
);

dashboardRouter.get(
  '/top-performers',
  requireAuth,
  validate(dashboardPeriodQuerySchema, 'query'),
  requireUserSubscription,
  getTopPerformersController
);

dashboardRouter.get(
  '/ai-stock-prediction',
  requireAuth,
  requireUserSubscription,
  getAiStockPredictionController
);

export default dashboardRouter;
