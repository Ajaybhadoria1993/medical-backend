import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacyDashboardService } from '../services/dashboard.service';
import { PharmacyDashboardAnalyticsService } from '../services/dashboardAnalytics.service';
import { PharmacySupplierService } from '../services/supplier.service';
import {
  DashboardPeriodQuery,
  DashboardSummaryQuery,
  SalesOverviewQuery,
} from '../schemas/dashboard.schema';

/**
 * Get dashboard statistics
 * Returns: Total medicines, low stock, prescriptions by status, today's sales, monthly revenue
 */
export const getDashboardStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyDashboardService.getDashboardStats(pharmacyId);

    res.json({
      success: true,
      message: 'Dashboard statistics retrieved successfully',
      data: result,
    });
  }
);

/**
 * Get sales chart data (week, month, or year)
 * Query params: period (week|month|year)
 */
export const getSalesChartDataController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const { period } = req.query;

    if (!period || !['week', 'month', 'year'].includes(String(period))) {
      res.status(400).json({
        success: false,
        message: 'Invalid period. Please use week, month, or year',
      });
      return;
    }

    const result = await PharmacyDashboardService.getSalesChartData(
      pharmacyId,
      String(period) as 'week' | 'month' | 'year'
    );

    res.json({
      success: true,
      message: `Sales data for ${period} retrieved successfully`,
      data: result,
    });
  }
);

/**
 * Get top selling medicines (top 20)
 */
export const getTopSellingMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result =
      await PharmacyDashboardService.getTopSellingMedicines(pharmacyId);

    res.json({
      success: true,
      message: 'Top selling medicines retrieved successfully',
      data: result,
    });
  }
);

/**
 * Get top suppliers (top 20)
 */
export const getTopSuppliersController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyDashboardService.getTopSuppliers(pharmacyId);

    res.json({
      success: true,
      message: 'Top suppliers retrieved successfully',
      data: result,
    });
  }
);

export const getDashboardSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery as DashboardSummaryQuery;

    const result = await PharmacyDashboardAnalyticsService.getSummary(
      pharmacyId,
      query
    );

    res.json({ success: true, result });
  }
);

export const getSalesOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery as SalesOverviewQuery;

    const result = await PharmacyDashboardAnalyticsService.getSalesOverview(
      pharmacyId,
      query
    );

    res.json({ success: true, result });
  }
);

export const getCategoryRevenueController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const { period } = req.validatedQuery as DashboardPeriodQuery;

    const result = await PharmacyDashboardAnalyticsService.getCategoryRevenue(
      pharmacyId,
      period
    );

    res.json({ success: true, result });
  }
);

export const getTopPerformersController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const { period } = req.validatedQuery as DashboardPeriodQuery;

    const result = await PharmacyDashboardAnalyticsService.getTopPerformers(
      pharmacyId,
      period
    );

    res.json({ success: true, result });
  }
);

export const getAiStockPredictionController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result =
      await PharmacyDashboardAnalyticsService.getAiStockPrediction(pharmacyId);

    res.json({ success: true, result });
  }
);
