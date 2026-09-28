import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { getValidatedQuery } from '../../../middlewear/validateZod';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { QueueService } from '../services/queue.service';
import type { QueueActionDto, QueueBoardQuery } from '../schemas/queue.schemas';

/**
 * GET /api/v1/appointments/queue/board?doctorId=&date=
 *
 * The single source of truth both the doctor's screen and the reception board
 * read. Returning the same object to both is what makes it impossible for them
 * to disagree about who is with the doctor.
 */
export const getQueueBoardController = asyncHandler(
  async (req: Request, res: Response) => {
    // From validateQuery — Express 5 makes req.query getter-only, so the
    // middleware cannot write the coerced result back onto it.
    const { doctorId, date } = getValidatedQuery<QueueBoardQuery>(res);

    // Always an array, whether one doctor was asked for or the whole clinic.
    // A shape that changes with the query forces every caller to branch, and
    // the reception board and a doctor's own screen then diverge in how they
    // read the same data.
    if (doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        req.user,
        req.clinicId,
        doctorId
      );
    }

    const doctors = doctorId
      ? [await QueueService.getBoard(req.clinicId, doctorId, date)]
      : await QueueService.getClinicBoards(
          req.clinicId,
          date,
          await StaffScopeService.getAccessibleDoctorIds(req.user, req.clinicId)
        );

    return sendOk(res, 'Queue board fetched successfully', {
      clinicId: req.clinicId,
      doctors,
      generatedAt: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/v1/appointments/queue/send-in
 *
 * Moves a checked-in patient to the front of the queue.
 *
 * Only the doctor whose queue it is also puts them in the room, so a button
 * pressed about the *next* patient can never end the current one's consultation.
 */
export const sendInController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body as QueueActionDto;

    const actorType = req.user?.userType;
    // The user id decides the room, not the role — see QueueService.sendIn.
    const board = await QueueService.sendIn(
      req.clinicId,
      appointmentId,
      actorType,
      req.user?.id
    );
    // Read off the board rather than re-deriving the rule, so the message can
    // never describe an action that did not happen.
    return sendOk(
      res,
      board.currentPatient?.appointmentId === appointmentId
        ? 'Patient sent in to the doctor'
        : 'Patient moved to the front of the queue',
      board
    );
  }
);

/**
 * POST /api/v1/appointments/queue/hold
 *
 * Marks a checked-in patient as unavailable. They keep their appointment and
 * their place; they are simply skipped when choosing who goes next.
 */
export const holdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body as QueueActionDto;

    const board = await QueueService.hold(req.clinicId, appointmentId);
    return sendOk(res, 'Patient put on hold', board);
  }
);

/**
 * POST /api/v1/appointments/queue/skip
 *
 * Parks the patient who didn't answer and starts the next one in the same
 * action. A skip is a hold plus an advance — the patient keeps their
 * appointment and is one Resume away from the queue, which is the safe
 * reading when someone is briefly out of the room.
 */
export const skipController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body as QueueActionDto;

    const board = await QueueService.skip(req.clinicId, appointmentId);
    return sendOk(res, 'Patient skipped and the next one sent in', board);
  }
);

/**
 * POST /api/v1/appointments/queue/resume
 *
 * Returns a held patient to the waiting list in their normal order. Holds
 * never clear by themselves, so this is the only way back.
 */
export const resumeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.body as QueueActionDto;

    const board = await QueueService.resume(req.clinicId, appointmentId);
    return sendOk(res, 'Patient resumed into the queue', board);
  }
);
