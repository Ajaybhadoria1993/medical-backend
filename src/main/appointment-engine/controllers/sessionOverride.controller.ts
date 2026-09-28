import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import {
  SessionOverrideService,
  SessionOverrideType,
} from '../services/sessionOverride.service';
import { AnnounceSessionOverrideDto } from '../schemas/sessionOverride.schemas';

/**
 * POST /api/v1/appointments/session-override
 *
 * Declares a delay on one or more doctors' day, for today. Two forms:
 *
 * - `running_late` — announces the delay. Estimates move; nothing is rewritten.
 * - `schedule_shift` — moves the day. The remaining appointments and the
 *   bookable window slide forward, so the capacity behind the delay survives.
 *   `dryRun: true` returns the before/after the confirm dialog shows, without
 *   writing.
 *
 * Sending `valueMinutes: 0` clears either one. Admins and receptionists may
 * target any doctor in their clinic; a doctor may only target themselves
 * (enforced in the service, which is where both the role and the target ids
 * are known).
 */
/**
 * Reception reads this line to confirm what just happened, so it names the
 * form as well as the number — "running late" and "schedule shifted" are
 * different promises to the patient, and a shift that moved nothing at all
 * (an empty or already-finished day) must not read as though it did.
 */
const buildMessage = (
  dto: AnnounceSessionOverrideDto,
  movedCount: number
): string => {
  if (dto.type !== 'schedule_shift') {
    return dto.valueMinutes === 0
      ? 'Running late cleared'
      : `Running late set to ${dto.valueMinutes} minutes`;
  }

  if (dto.dryRun) return 'Schedule shift preview';
  if (dto.valueMinutes === 0) return 'Schedule shift reverted';

  return movedCount > 0
    ? `Schedule shifted by ${dto.valueMinutes} minutes`
    : 'Schedule shifted; no appointments needed moving';
};

export const announceSessionOverrideController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context is required');
    }
    if (!user) {
      throw new HttpError(401, 'Authentication required');
    }

    const dto = (req.validatedBody ?? req.body) as AnnounceSessionOverrideDto;

    const result = await SessionOverrideService.announce(
      clinicId,
      { id: user.id, userType: user.userType },
      dto
    );

    const movedCount = (result.shifts ?? []).reduce(
      (total, shift) => total + shift.appointments.length,
      0
    );

    const message = buildMessage(dto, movedCount);

    return sendOk(res, message, result);
  }
);

/**
 * GET /api/v1/appointments/session-override
 *
 * Today's active overrides for the clinic. Optional `doctorIds` (repeated or
 * comma-separated) narrows it; with none, every doctor currently running late
 * is returned, so the reception board can badge all its cards in one call.
 */
export const getSessionOverridesController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context is required');
    }

    const query = (req.validatedQuery ?? req.query) as {
      doctorIds?: string[];
      type?: SessionOverrideType;
      forDate?: string;
    };

    const result = await SessionOverrideService.getActiveForClinic(
      clinicId,
      query.doctorIds,
      query.type,
      query.forDate
    );

    return sendOk(res, 'Session overrides fetched successfully', result);
  }
);

/**
 * GET /api/v1/appointments/session-override/history
 *
 * Every override written for a day, cleared ones included, newest first. This
 * is the audit view: which doctor, what value, who set it, and which row is
 * the one currently in effect.
 */
export const getSessionOverrideHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context is required');
    }

    const query = (req.validatedQuery ?? req.query) as {
      forDate?: string;
      doctorIds?: string[];
      limit?: number;
      cursor?: string;
    };

    const result = await SessionOverrideService.getHistoryForClinic(
      clinicId,
      query.forDate,
      query.doctorIds,
      query.limit,
      query.cursor
    );

    return sendOk(res, 'Session override history fetched successfully', result);
  }
);
