import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { AutoRenewService } from '../services/autoRenew.service';

/**
 * Get auto-renewal status
 * GET /api/v1/subscription/auto-renew/status
 */
export const getAutoRenewStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const status = await AutoRenewService.getAutoRenewStatus(clinicId);

    return sendOk(res, 'Auto-renewal status fetched', status);
  }
);

/**
 * Enable auto-renewal
 * POST /api/v1/subscription/auto-renew/enable
 */
export const enableAutoRenew = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await AutoRenewService.enableAutoRenew(clinicId);

    return sendOk(res, 'Auto-renewal enabled successfully', result);
  }
);

/**
 * Disable auto-renewal
 * POST /api/v1/subscription/auto-renew/disable
 */
export const disableAutoRenew = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await AutoRenewService.disableAutoRenew(clinicId);

    return sendOk(
      res,
      'Auto-renewal disabled. Your plan remains active until the current period ends.',
      result
    );
  }
);
