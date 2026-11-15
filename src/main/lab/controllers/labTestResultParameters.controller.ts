import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabTestResultParametersService } from '../services/labTestResultParameters.service';
import { getLabControllerContext } from './labControllerContext';

export const createLabTestResultParameterController = asyncHandler(
  async (req: Request, res: Response) => {
    const parameter = await LabTestResultParametersService.createParameter(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(
      res,
      'Lab test result parameter created successfully',
      parameter
    );
  }
);

export const getLabTestResultParametersController = asyncHandler(
  async (req: Request, res: Response) => {
    const parameters = await LabTestResultParametersService.getParameters(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test result parameters fetched successfully', parameters);
  }
);

export const getLabTestResultParametersByTestIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const parameters =
      await LabTestResultParametersService.getParametersByTestId(
        req.validatedParams.testId,
        getLabControllerContext(req)
      );

    sendOk(res, 'Lab test result parameters fetched successfully', parameters);
  }
);

export const updateLabTestResultParameterController = asyncHandler(
  async (req: Request, res: Response) => {
    const parameter = await LabTestResultParametersService.updateParameter(
      req.validatedParams.parameterId,
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test result parameter updated successfully', parameter);
  }
);
