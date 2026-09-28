// clinic-symptom.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { ClinicSymptomService } from '../services/clinic-symptom.service';

export const createClinicSymptomController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const payload = req.validatedBody;

    const result = await ClinicSymptomService.create(clinicId, payload);
    res.json({ success: true, result });
  }
);

export const updateClinicSymptomController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const id = req.params.id as string;

    const result = await ClinicSymptomService.update(
      id,
      clinicId,
      req.validatedBody
    );

    res.json({ success: true, result });
  }
);

export const deleteClinicSymptomController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const id = req.params.id as string;

    await ClinicSymptomService.delete(id, clinicId);
    res.json({ success: true });
  }
);

// clinic-symptom.controller.ts
export const getClinicSymptomsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const search = req.query.search as string | undefined;

    const result = await ClinicSymptomService.getByClinic(clinicId, search);

    res.json({
      success: true,
      count: result.length,
      result,
    });
  }
);
