import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReportsCustomService } from '../services/reportsCustom.service';

/**
 * GET /api/v1/reports-overview/custom/schema
 */
export const getReportsCustomSchemaController = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = ReportsCustomService.getSchema();

    return sendOk(res, 'Custom report schema fetched successfully', data);
  }
);

/**
 * POST /api/v1/reports-overview/custom/run
 */
export const runReportsCustomController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const data = await ReportsCustomService.runReport(
      clinicId,
      req.validatedBody
    );

    return sendOk(res, 'Custom report generated successfully', {
      ...data,
      meta: { generatedAt: new Date().toISOString() },
    });
  }
);
