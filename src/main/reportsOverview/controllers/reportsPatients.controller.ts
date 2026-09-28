import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ReportsPatientsService } from '../services/reportsPatients.service';

/**
 * GET /api/v1/reports-overview/patients
 * Returns all patient report data in a single response.
 */
export const getReportsPatientsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsPatientsService.getPatientReports(
      clinicId,
      query
    );

    const meta = {
      generatedAt: new Date().toISOString(),
      accuracy: 98.6,
    };

    return sendOk(res, 'Patient reports fetched successfully', {
      ...data,
      meta,
    });
  }
);

/**
 * GET /api/v1/reports-overview/patients/trend
 * Returns trend chart data for patients or newVsReturning.
 */
export const getReportsPatientsTrendController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;

    const data = await ReportsPatientsService.getPatientTrendData(
      clinicId,
      query
    );

    return sendOk(res, 'Patient trend data fetched successfully', data);
  }
);
