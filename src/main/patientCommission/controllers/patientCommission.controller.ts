import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { BillService } from '../services/bill.service';

const actorOf = (req: Request) => ({
  id: req.user!.id,
  userType: req.user!.userType,
});

export const getCommissionOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await BillService.overview({
      clinicId: req.clinicId!,
      actor: actorOf(req),
      date: req.validatedQuery.date,
    });
    return sendOk(res, 'Patient bill fetched successfully', data);
  }
);

export const getDoctorAppointmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { date, pageNumber, pageSize } = req.validatedQuery;
    const data = await BillService.doctorAppointments({
      clinicId: req.clinicId!,
      actor: actorOf(req),
      doctorId: req.validatedParams.doctorId,
      date,
      pageNumber,
      pageSize,
    });
    return sendOk(res, 'Billed appointments fetched successfully', data);
  }
);
