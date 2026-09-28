// src/main/appointments/controllers/v2/appointment.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { AppointmentServiceV2 } from '../../services/v2/appointment.service';

export const getAvailableSlotsV2Controller = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, validatedQuery, validatedParams } = req;
    const result = await AppointmentServiceV2.getAvailableSlots(
      clinicId,
      validatedParams.doctorId,
      validatedQuery.date
    );
    sendOk(res, 'Available slots fetched successfully', result);
  }
);
