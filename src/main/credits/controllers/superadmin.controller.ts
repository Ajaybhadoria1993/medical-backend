import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { ClinicCreditsService } from '../services/core/clinicCredits.service';
import { PacksService } from '../services/core/packs.service';
import { CreditSettingsService } from '../services/core/settings.service';
import { CostReportService } from '../services/messaging/costReport.service';

export const getCreditSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await CreditSettingsService.current(
      req.validatedParams.creditType
    );
    return sendOk(res, 'Credit settings fetched successfully', data);
  }
);

export const getCreditSettingsHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pageNumber, pageSize } = req.validatedQuery;
    const data = await CreditSettingsService.history(
      req.validatedParams.creditType,
      pageNumber,
      pageSize
    );
    return sendOk(res, 'Credit settings history fetched successfully', data);
  }
);

export const changeCreditSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await CreditSettingsService.change(
      req.validatedParams.creditType,
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Credit settings changed successfully', data);
  }
);

export const getClinicCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ClinicCreditsService.overview(
      req.validatedParams.clinicId,
      req.validatedQuery
    );
    return sendOk(res, 'Clinic credits fetched successfully', data);
  }
);

export const grantClinicCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ClinicCreditsService.grant(
      req.validatedParams.clinicId,
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Credits added successfully', data);
  }
);

export const removeClinicCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ClinicCreditsService.remove(
      req.validatedParams.clinicId,
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Credits removed successfully', data);
  }
);

export const getCreditPacksController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PacksService.list(req.validatedParams.creditType);
    return sendOk(res, 'Credit packs fetched successfully', data);
  }
);

export const createCreditPackController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PacksService.create(
      req.validatedParams.creditType,
      req.validatedBody,
      req.user!.id
    );
    return sendCreated(res, 'Credit pack added successfully', data);
  }
);

export const updateCreditPackController = asyncHandler(
  async (req: Request, res: Response) => {
    const { creditType, packId } = req.validatedParams;
    const data = await PacksService.update(
      creditType,
      packId,
      req.validatedBody,
      req.user!.id
    );
    return sendOk(res, 'Credit pack updated successfully', data);
  }
);

export const getCostReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await CostReportService.build(req.validatedQuery);
    return sendOk(res, 'Cost report fetched successfully', data);
  }
);
