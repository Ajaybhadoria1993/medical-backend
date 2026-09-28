import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendCreated } from '../../../utils/response.utils';
import { MissedSlotDismissalService } from '../services/missedSlotDismissal.service';
import { DismissMissedSlotDto } from '../schemas/missedSlotDismissal.schemas';

/** POST /api/v1/appointments/missed-slot/dismiss — marks a past, never-booked slot as handled so it stops showing as Missed/Available. */
export const dismissMissedSlotController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const dto = (req.validatedBody ?? req.body) as DismissMissedSlotDto;

    const result = await MissedSlotDismissalService.dismissSlot(
      clinicId,
      { id: user.id, userType: user.userType },
      dto
    );

    return sendCreated(res, 'Slot dismissed', result);
  }
);
