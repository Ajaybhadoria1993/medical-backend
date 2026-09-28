import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { VisitingRequestService } from '../services/visitingRequest.service';

export const getAllVisitingRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;
    const result = await VisitingRequestService.getAllVisitingRequests(
      clinicId,
      query
    );
    return sendOk(res, 'Visiting requests fetched successfully', result);
  }
);

export const getRelatedAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { appointmentId } = req.validatedParams;
    const result = await VisitingRequestService.getRelatedAppointments(
      appointmentId,
      clinicId
    );
    return sendOk(res, 'Related appointments fetched successfully', result);
  }
);

export const cancelVisitingRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;
    const { id } = req.validatedParams;
    const result = await VisitingRequestService.cancelVisitingRequest(
      id,
      clinicId,
      user
    );
    return sendOk(res, 'Visiting request cancelled successfully', result);
  }
);

export const findVisitingRequestController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery;
    const result = await VisitingRequestService.findVisitingRequest(
      clinicId,
      query
    );
    return sendOk(res, 'Visiting request lookup completed', result);
  }
);
