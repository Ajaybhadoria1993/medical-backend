import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import type {
  LabDashboardQueryInput,
  LabOrderCountTrendQueryInput,
} from '../schemas/labDashboard.schemas';
import { LabDashboardService } from '../services/labDashboard.service';
import { getLabControllerContext } from './labControllerContext';

export const getLabDashboardCardsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabDashboardService.getCards(
      getLabControllerContext(req),
      req.validatedQuery as LabDashboardQueryInput
    );

    return sendOk(res, 'Lab dashboard cards fetched successfully', result);
  }
);

export const getLabOrderStatusDistributionController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabDashboardService.getOrderStatusDistribution(
      getLabControllerContext(req),
      req.validatedQuery as LabDashboardQueryInput
    );

    return sendOk(
      res,
      'Lab order status distribution fetched successfully',
      result
    );
  }
);

export const getMostUsedTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabDashboardService.getMostUsedTests(
      getLabControllerContext(req),
      req.validatedQuery as LabDashboardQueryInput
    );

    return sendOk(res, 'Most used lab tests fetched successfully', result);
  }
);

export const getLabBillingSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabDashboardService.getBillingSummary(
      getLabControllerContext(req),
      req.validatedQuery as LabDashboardQueryInput
    );

    return sendOk(res, 'Lab billing summary fetched successfully', result);
  }
);

export const getLabOrderCountTrendController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.validatedQuery as LabOrderCountTrendQueryInput;
    const result = await LabDashboardService.getOrderCountTrend(
      getLabControllerContext(req),
      query.filter
    );

    return sendOk(res, 'Lab order count trend fetched successfully', result);
  }
);
