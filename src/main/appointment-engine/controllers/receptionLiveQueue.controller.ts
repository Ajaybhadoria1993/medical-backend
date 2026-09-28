import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { ReceptionLiveQueueService } from '../services/receptionLiveQueue.service';

/**
 * GET /api/v1/appointments/reception/live-queue
 *
 * Clinic-wide snapshot of every doctor/admin's live queue (status,
 * waiting count, next-in-queue, current running patient). Real-time
 * updates for the same data are pushed over Socket.io as
 * "reception.liveQueue.updated" to the `clinic:{clinicId}` room
 * (clients are auto-joined to it on socket connect).
 */
export const getReceptionLiveQueueController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      req.user,
      clinicId
    );

    const result = await ReceptionLiveQueueService.getLiveQueueBoard(
      clinicId,
      undefined,
      allowedDoctorIds
    );
    return sendOk(res, 'Live doctor queue fetched successfully', result);
  }
);
