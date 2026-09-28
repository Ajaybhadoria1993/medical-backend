import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { DoctorArrivalService } from '../services/doctorArrival.service';
import { MarkDoctorArrivalDto } from '../schemas/doctorArrival.schemas';

/** POST /api/v1/appointments/doctor-arrival — Doctor marks own arrival; Admin/Receptionist can mark any clinic doctor. */
export const markDoctorArrivalController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context is required');
    }
    if (!user) {
      throw new HttpError(401, 'Authentication required');
    }

    const dto = (req.validatedBody ?? req.body) as MarkDoctorArrivalDto;

    const source = user.userType === 'Doctor' ? 'self' : 'reception';

    const result = await DoctorArrivalService.markArrival(
      clinicId,
      { id: user.id, userType: user.userType },
      dto,
      source
    );

    return sendOk(res, 'Doctor arrival recorded', result);
  }
);

/** GET /api/v1/appointments/doctor-arrival — today's arrived doctors, optionally narrowed by `doctorIds`. */
export const getDoctorArrivalController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context is required');
    }

    const query = (req.validatedQuery ?? req.query) as {
      doctorIds?: string[];
      allSessions?: boolean;
    };

    const result = await DoctorArrivalService.getActiveForClinic(
      clinicId,
      query.doctorIds,
      query.allSessions
    );

    return sendOk(res, 'Doctor arrival status fetched successfully', result);
  }
);
