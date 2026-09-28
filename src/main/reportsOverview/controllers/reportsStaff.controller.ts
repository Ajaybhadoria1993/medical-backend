import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReportsStaffService } from '../services/reportsStaff.service';

/**
 * GET /api/v1/reports-overview/staff
 */
export const getReportsStaffController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsStaffService.getStaffReports(clinicId, query);

    return sendOk(res, 'Staff reports fetched successfully', {
      ...data,
      meta: { generatedAt: new Date().toISOString() },
    });
  }
);

/**
 * GET /api/v1/reports-overview/staff/trend
 */
export const getReportsStaffTrendController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsStaffService.getStaffTrendData(clinicId, query);

    return sendOk(res, 'Staff trend data fetched successfully', data);
  }
);
