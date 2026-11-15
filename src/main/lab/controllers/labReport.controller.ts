import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabReportService } from '../services/labReport.service';
import { getLabControllerContext } from './labControllerContext';

export const getLabReportConfigurationController = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await LabReportService.getReportConfiguration(
      getLabControllerContext(req)
    );
    sendOk(res, 'Lab report configuration fetched successfully', report);
  }
);

export const upsertLabReportConfigurationController = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await LabReportService.upsertReportConfiguration(
      req.validatedBody,
      getLabControllerContext(req)
    );
    sendCreated(res, 'Lab report configuration saved successfully', report);
  }
);

export const previewLabReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const html = await LabReportService.previewReport(req.validatedBody);
    res.status(200).json({
      success: true,
      html,
    });
  }
);
