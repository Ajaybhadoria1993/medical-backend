import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { GrantsService } from '../services/core/grants.service';
import { SummaryService } from '../services/messaging/summary.service';

// The clinic comes from the token (requireClinic), never from the request.

export const getCreditSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await SummaryService.forClinic(
      req.clinicId!,
      req.validatedQuery.creditType
    );
    return sendOk(res, 'Credit summary fetched successfully', data);
  }
);

export const listClinicGrantsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { creditType, pageNumber, pageSize } = req.validatedQuery;
    const data = await GrantsService.list(
      req.clinicId!,
      creditType,
      pageNumber,
      pageSize
    );
    return sendOk(res, 'Credit history fetched successfully', data);
  }
);
