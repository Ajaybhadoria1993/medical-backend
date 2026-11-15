import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabOrderService } from '../services/labOrder.service';
import { LabReportService } from '../services/labReport.service';
import { getLabControllerContext } from './labControllerContext';

type UploadedLocationFile = Express.Multer.File & { location?: string };

export const addWalkinLabOrderController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.addWalkinLabOrder(
      getLabControllerContext(req),
      req.validatedBody
    );

    sendCreated(res, 'Walk-in lab order created successfully', result);
  }
);

export const getLabOrderParametersController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.getLabOrderParameters(
      getLabControllerContext(req),
      req.validatedBody.labOrderIds
    );

    sendOk(res, 'Lab order parameters fetched successfully', result);
  }
);

export const saveLabUpdatedResultsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.saveLabUpdatedResults(
      getLabControllerContext(req),
      req.validatedBody
    );

    sendOk(res, 'Lab order results saved successfully', result);
  }
);

export const getLabOrderReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabReportService.generateReportsForOrders(
      req.validatedBody.labOrderIds,
      getLabControllerContext(req),
      { skipAssignmentCheck: true, logActivity: true }
    );

    sendOk(res, 'Lab report generated successfully', result);
  }
);

export const generateLabOrderReportPdfController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabReportService.generateAndUploadReportsForOrders(
      req.validatedBody.labOrderIds,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab order report PDFs generated successfully', result);
  }
);

export const getLabOrdersController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.getLabOrders(
      getLabControllerContext(req),
      req.validatedQuery,
      [],
      {
        excludeNotRequiredSampleStatus: true,
        splitMixedWorkflowGroups: true,
      }
    );

    sendOk(res, 'Lab orders fetched successfully', result);
  }
);

export const getLabOrderCountsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.getLabOrderCounts(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab order status counts fetched successfully', result);
  }
);

export const searchLabOrdersBySampleCodeController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.searchLabOrdersBySampleCode(
      getLabControllerContext(req),
      req.validatedParams.sampleCode,
      req.validatedQuery
    );

    sendOk(res, 'Lab orders fetched successfully', result);
  }
);

export const getLabOrderByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.getLabOrderById(
      req.validatedParams.labOrderId,
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab order fetched successfully', result);
  }
);

export const updateLabOrdersController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.updateLabOrders(
      getLabControllerContext(req),
      req.validatedBody
    );

    sendOk(res, 'Lab orders updated successfully', result);
  }
);

export const bulkUploadLabOrderReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const reportPdf = (req.file as UploadedLocationFile | undefined)?.location;

    if (!reportPdf) {
      throw new HttpError(400, 'reportPdf file is required');
    }

    const result = await LabOrderService.bulkUploadReportPdf(
      getLabControllerContext(req),
      req.validatedBody,
      reportPdf
    );

    sendOk(res, 'Lab order reports uploaded successfully', result);
  }
);
