import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ExtraSlotsService } from '../services/extraSlots.service';
import {
  GetExtraSlotsQueryDto,
  SetExtraSlotsDto,
} from '../schemas/extraSlots.schemas';

/** GET /api/v1/appointments/extra-slots — current extra-slot setup for a doctor's session(s) on a date. */
export const getExtraSlotsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const query = (req.validatedQuery ?? req.query) as GetExtraSlotsQueryDto;

    const doctorId = user.userType === 'Doctor' ? user.id : query.doctorId;
    if (!doctorId) throw new HttpError(400, 'doctorId is required');

    const result = await ExtraSlotsService.getExtraSlots(
      clinicId,
      doctorId,
      query.date,
      query.sessionStart
    );

    return sendOk(res, 'Extra slots fetched successfully', result);
  }
);

/** POST /api/v1/appointments/extra-slots — add (or clear) extra bookable slots after one session. */
export const setExtraSlotsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const dto = (req.validatedBody ?? req.body) as SetExtraSlotsDto;

    const result = await ExtraSlotsService.setExtraSlots(
      clinicId,
      { id: user.id, userType: user.userType },
      dto
    );

    return sendOk(res, 'Extra slots saved', result);
  }
);
