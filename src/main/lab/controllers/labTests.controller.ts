import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabTestsService } from '../services/labTests.service';
import { getLabControllerContext } from './labControllerContext';

export const createLabTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const test = await LabTestsService.createTest(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(res, 'Lab test created successfully', test);
  }
);

export const getLabTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabTestsService.getTests(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab tests fetched successfully', result);
  }
);

export const getLabTestByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const test = await LabTestsService.getTestById(
      req.validatedParams.testId,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test fetched successfully', test);
  }
);

export const updateLabTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const test = await LabTestsService.updateTest(
      req.validatedParams.testId,
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test updated successfully', test);
  }
);
