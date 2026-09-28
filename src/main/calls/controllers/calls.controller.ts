import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import {
  getValidatedParams,
  getValidatedQuery,
} from '../../../middlewear/validateZod';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { CallsService } from '../services/calls.service';
import type {
  ActiveCallsQuery,
  CallIdParams,
  PlaceCallBody,
} from '../schemas/calls.schema';

export const getActiveCallsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { withReceptionists } = getValidatedQuery<ActiveCallsQuery>(res);
    const data = await CallsService.getActive(
      req.user,
      req.clinicId,
      withReceptionists
    );
    return sendOk(res, 'Calls fetched successfully', data);
  }
);

export const placeCallController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await CallsService.placeCall(
      req.user,
      req.clinicId,
      req.body as PlaceCallBody
    );
    return sendCreated(res, 'Call placed', data);
  }
);

const callAction = (action: 'answer' | 'decline' | 'cancel', message: string) =>
  asyncHandler(async (req: Request, res: Response) => {
    const { callId } = getValidatedParams<CallIdParams>(res);
    const data = await CallsService[action](req.user, req.clinicId, callId);
    return sendOk(res, message, data);
  });

export const answerCallController = callAction('answer', 'Call answered');
export const declineCallController = callAction('decline', 'Call declined');
export const cancelCallController = callAction('cancel', 'Call cancelled');
