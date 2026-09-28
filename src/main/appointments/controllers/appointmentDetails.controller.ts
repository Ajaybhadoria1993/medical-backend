import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { AppointmentDetailsService } from '../services/appointmentDetails.service';

export const getAppointmentDetailsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await AppointmentDetailsService.getDetails(
      req.validatedParams.appointmentId,
      {
        id: req.user.id,
        userType: req.user.userType,
        clinicId: req.clinicId,
      }
    );
    return sendOk(res, 'Appointment details fetched successfully', result);
  }
);
