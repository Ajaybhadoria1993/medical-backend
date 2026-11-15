import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PatientConsentFormsService } from '../services/consentForms.service';

export const getPatientConsentFormsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientConsentFormsService.list(
      req.clinicId!,
      req.user!,
      req.params.patientId as string
    );
    return sendOk(res, 'Consent forms fetched successfully', result);
  }
);
