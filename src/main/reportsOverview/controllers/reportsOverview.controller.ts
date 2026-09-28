import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReportsOverviewService } from '../services/reportsOverview.service';

/**
 * GET /api/v1/reports-overview
 * Returns all overview data for the Reports page in a single response.
 */
export const getReportsOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsOverviewService.getOverview(clinicId, query);

    const meta = {
      generatedAt: new Date().toISOString(),
      accuracy: 98.6,
    };

    return sendOk(res, 'Reports overview fetched successfully', {
      ...data,
      meta,
    });
  }
);

/**
 * GET /api/v1/reports-overview/trend
 * Returns trend chart data for a specific type and period.
 * Called only when user changes the period selector.
 */
export const getReportsOverviewTrendController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsOverviewService.getTrend(clinicId, query);

    return sendOk(res, 'Trend data fetched successfully', data);
  }
);
