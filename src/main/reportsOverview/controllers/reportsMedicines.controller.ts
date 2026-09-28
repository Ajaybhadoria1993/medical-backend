import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReportsMedicinesService } from '../services/reportsMedicines.service';

/**
 * GET /api/v1/reports-overview/medicines
 */
export const getReportsMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsMedicinesService.getMedicineReports(
      clinicId,
      query
    );

    return sendOk(res, 'Medicine reports fetched successfully', {
      ...data,
      meta: { generatedAt: new Date().toISOString() },
    });
  }
);

/**
 * GET /api/v1/reports-overview/medicines/trend
 */
export const getReportsMedicinesTrendController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsMedicinesService.getMedicineTrendData(
      clinicId,
      query
    );

    return sendOk(res, 'Medicine trend data fetched successfully', data);
  }
);
