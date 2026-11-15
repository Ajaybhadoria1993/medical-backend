import type { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import type {
  AddPatientVaccineDto,
  PatientVaccineIdParamsDto,
  PatientVaccinePatientParamsDto,
} from '../schemas/patientVaccine.schema';
import { PatientVaccineService } from '../services/patientVaccine.service';

export const listPatientVaccinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { patientId } = req.validatedParams as PatientVaccinePatientParamsDto;
    const result = await PatientVaccineService.list(
      patientId,
      req.clinicId as string
    );
    sendOk(res, 'Vaccines fetched successfully', result);
  }
);

export const addPatientVaccineController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.validatedBody as AddPatientVaccineDto;
    const result = await PatientVaccineService.add(
      body,
      req.clinicId as string,
      req.user!.id
    );
    sendCreated(res, 'Vaccine recorded', result);
  }
);

export const removePatientVaccineController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams as PatientVaccineIdParamsDto;
    const result = await PatientVaccineService.remove(
      id,
      req.clinicId as string
    );
    sendOk(res, 'Vaccine entry removed', result);
  }
);
