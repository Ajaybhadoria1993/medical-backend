import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { SlotConfigService } from '../services/slotConfig.service';
import { AvailableSlotsService } from '../services/availableSlots.service';
import { MissedSlotOptionsService } from '../services/missedSlotOptions.service';
import {
  GetSlotConfigQueryDto,
  SetSlotConfigDto,
  GetAvailableSlotsQueryDto,
  GetMissedSlotOptionsQueryDto,
} from '../schemas/slotConfig.schemas';

/** GET /api/v1/appointments/slot-config — current slot setup for a doctor's sessions on a date. */
export const getSlotConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const query = (req.validatedQuery ?? req.query) as GetSlotConfigQueryDto;

    const doctorId = user.userType === 'Doctor' ? user.id : query.doctorId;
    if (!doctorId) throw new HttpError(400, 'doctorId is required');

    const result = await SlotConfigService.getSlotConfig(
      clinicId,
      doctorId,
      query.date,
      query.sessionStart
    );

    return sendOk(res, 'Slot config fetched successfully', result);
  }
);

/** POST /api/v1/appointments/slot-config — customize one shift's slots for a future/current date. */
export const setSlotConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const dto = (req.validatedBody ?? req.body) as SetSlotConfigDto;

    const result = await SlotConfigService.setSlotConfig(
      clinicId,
      { id: user.id, userType: user.userType },
      dto
    );

    return sendOk(res, 'Slot config saved', result);
  }
);

/** GET /api/v1/appointments/available-slots — custom-slot-aware bookable slots, layering any live `slot_config` override on top. */
export const getAvailableSlotsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const query = (req.validatedQuery ??
      req.query) as GetAvailableSlotsQueryDto;

    const doctorId = user.userType === 'Doctor' ? user.id : query.doctorId;
    if (!doctorId) throw new HttpError(400, 'doctorId is required');

    const result = await AvailableSlotsService.getAvailableSlots(
      clinicId,
      doctorId,
      query.date
    );

    return sendOk(res, 'Available slots fetched successfully', result);
  }
);

/**
 * GET /api/v1/appointments/missed-slot-options — what a receptionist may do
 * with a slot whose time has passed: shift it (and to exactly where), or record
 * it at its original time. The placement rules live in the service so the
 * client renders the answer rather than deriving it.
 */
export const getMissedSlotOptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) throw new HttpError(400, 'Clinic context is required');
    if (!user) throw new HttpError(401, 'Authentication required');

    const query = (req.validatedQuery ??
      req.query) as GetMissedSlotOptionsQueryDto;

    const doctorId = user.userType === 'Doctor' ? user.id : query.doctorId;
    if (!doctorId) throw new HttpError(400, 'doctorId is required');

    const result = await MissedSlotOptionsService.getOptions(
      clinicId,
      doctorId,
      query.date,
      query.slotStart
    );

    return sendOk(res, 'Missed slot options fetched successfully', result);
  }
);
