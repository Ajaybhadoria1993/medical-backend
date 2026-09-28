import { Request, Response } from 'express';
import { HttpError } from '../../../middlewear/errorHandler';
import { scanPrescriptionWithAgent } from '../services/prescription.agent.service';
import { getDummyPrescriptionData } from '../services/prescription.testing';
import { scanPrescriptionSchema } from '../validators/prescription.validator';

export const getDummyPrescription = (_req: Request, res: Response) => {
  return res.status(200).json({
    message: 'Dummy prescription data',
    data: getDummyPrescriptionData(),
  });
};

export const scanPrescription = async (req: Request, res: Response) => {
  const parsed = scanPrescriptionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid payload',
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await scanPrescriptionWithAgent(parsed.data);

    return res.status(200).json({
      message: 'Prescription processed',
      ...result,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 502) {
      const details =
        error.details && typeof error.details === 'object'
          ? (error.details as {
              code?: string;
              validationIssues?: string[];
            })
          : {};

      return res.status(502).json({
        success: false,
        status: 502,
        message: error.message,
        code: details.code,
        validationIssues: details.validationIssues ?? [],
      });
    }

    throw error;
  }
};
