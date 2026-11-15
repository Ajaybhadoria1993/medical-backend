import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabOrderService } from '../services/labOrder.service';
import { LabUpdatedService } from '../services/labUpdated.service';
import { getLabControllerContext } from './labControllerContext';

export const getLabBillingHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabOrderService.getBillingHistory(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab billing history fetched successfully', result);
  }
);

export const getReferringDoctorsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabUpdatedService.getReferringDoctors(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Referring doctors fetched successfully', result);
  }
);

export const getLabUpdatedDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const lab = await LabUpdatedService.getLabDetails(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab details fetched successfully', lab);
  }
);

export const getLabUpdatedActiveDepartmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabUpdatedService.hasActiveDepartment(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab active department status fetched successfully', result);
  }
);

export const getLabUpdatedSuggestionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const suggestions = await LabUpdatedService.getDefaultSuggestionsForLab(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab default suggestions fetched successfully', suggestions);
  }
);

export const getLabSampleCodeSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const settings = await LabUpdatedService.getSampleCodeSettings(
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab sample code settings fetched successfully', settings);
  }
);

export const updateLabSampleCodeSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const settings = await LabUpdatedService.updateSampleCodeSettings(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab sample code settings updated successfully', settings);
  }
);

export const getLabUpdatedTestResultParametersController = asyncHandler(
  async (req: Request, res: Response) => {
    const parameters = await LabUpdatedService.getTestResultParametersByTestIds(
      req.validatedQuery.testIds,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test result parameters fetched successfully', parameters);
  }
);

export const getLabOrderActivitiesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabUpdatedService.getLabOrderActivities(
      getLabControllerContext(req),
      req.validatedBody
    );

    sendOk(res, 'Lab order activities fetched successfully', result);
  }
);

export const applyLabUpdatedSuggestionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabUpdatedService.applySuggestions(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(res, 'Lab default suggestions applied successfully', result);
  }
);
