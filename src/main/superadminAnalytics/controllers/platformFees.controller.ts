import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import logger from '../../../utils/logger';
import { PlatformFeesService } from '../services/platformFees.service';
import type {
  PlatformFeePreviewDto,
  PlatformFeeSaveDto,
} from '../schemas/platformFees.schema';

/** Default fees, or one clinic's when `clinicId` is given, with the limits and clinics on their own fees. */
export const getPlatformFeesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedQuery as { clinicId?: string };
    return sendOk(
      res,
      'Platform fees',
      await PlatformFeesService.overview(clinicId ?? null)
    );
  }
);

/** Saves one fee as a new version for the default or a clinic; refused outside the limits. */
export const savePlatformFeeController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.validatedBody as PlatformFeeSaveDto;
    const row = await PlatformFeesService.save(body, req.user!.id);
    logger.warn(
      `[PlatformFees] ${body.feeType} for ${body.clinicId ?? 'all clinics'} set to ${body.method} ${body.amount} by ${req.user!.id}`
    );
    return sendOk(res, 'Fee saved', {
      id: row.id,
      effectiveFrom: row.effectiveFrom,
    });
  }
);

/** What a patient pays now and with a proposed change. */
export const previewPlatformFeeController = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'Fee preview',
      await PlatformFeesService.preview(
        req.validatedBody as PlatformFeePreviewDto
      )
    );
  }
);

/** Puts a clinic back on the default fees from now. */
export const resetClinicFeesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams as { clinicId: string };
    const closed = await PlatformFeesService.resetClinic(clinicId);
    logger.warn(
      `[PlatformFees] Clinic ${clinicId} reset to default fees by ${req.user!.id}`
    );
    return sendOk(res, 'Clinic uses default fees', { closed });
  }
);

/** Every saved version of the default or a clinic's own fees, with who saved it. */
export const platformFeeHistoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedQuery as { clinicId?: string };
    return sendOk(
      res,
      'Fee history',
      await PlatformFeesService.history(clinicId ?? null)
    );
  }
);
