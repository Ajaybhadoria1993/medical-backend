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
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const dashboardRouter = express.Router();

dashboardRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getDashboardStatsController
);

dashboardRouter.get(
  '/sales-chart',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getSalesChartDataController
);

dashboardRouter.get(
  '/top-selling-medicines',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getTopSellingMedicinesController
);

dashboardRouter.get(
  '/top-suppliers',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getTopSuppliersController
);

dashboardRouter.get(
  '/summary',
  requireAuth,
  validate(dashboardSummaryQuerySchema, 'query'),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getDashboardSummaryController
);

dashboardRouter.get(
  '/sales-overview',
  requireAuth,
  validate(salesOverviewQuerySchema, 'query'),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getSalesOverviewController
);

dashboardRouter.get(
  '/category-revenue',
  requireAuth,
  validate(dashboardPeriodQuerySchema, 'query'),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getCategoryRevenueController
);

dashboardRouter.get(
  '/top-performers',
  requireAuth,
  validate(dashboardPeriodQuerySchema, 'query'),
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getTopPerformersController
);

dashboardRouter.get(
  '/ai-stock-prediction',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getAiStockPredictionController
);

export default dashboardRouter;
