import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import {
  FeatureKey,
  FEATURE_KEYS,
  LimitationService,
} from '../services/limitation.service';

/**
 * GET /api/v1/users/limitations/overview
 * Get all plan limits and current usage for the authenticated clinic
 */
export const getClinicLimitsOverview = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const overview = await LimitationService.getClinicLimitsOverview(clinicId);

    return sendOk(res, 'Clinic limits overview fetched successfully', overview);
  }
);

/**
 * GET /api/v1/users/limitations/check/:featureKey
 * Check if a specific feature is available/within limits
 */
export const checkFeatureLimit = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const featureKey = req.params.featureKey as string;

    // Validate feature key
    const validKeys = Object.values(FEATURE_KEYS);
    if (!validKeys.includes(featureKey as FeatureKey)) {
      throw new HttpError(
        400,
        `Invalid feature key. Valid keys: ${validKeys.join(', ')}`
      );
    }

    // Check if it's a usage-based or boolean feature
    const usageBasedFeatures: string[] = [FEATURE_KEYS.WHATSAPP_MESSAGES];

    if (usageBasedFeatures.includes(featureKey)) {
      const result = await LimitationService.checkUsageLimit(
        clinicId,
        featureKey as FeatureKey
      );
      return sendOk(res, 'Usage limit check completed', result);
    }

    // Account-based features
    if (featureKey === FEATURE_KEYS.DOCTOR_ACCOUNTS) {
      const result = await LimitationService.checkDoctorLimit(clinicId);
      return sendOk(res, 'Doctor limit check completed', result);
    }

    if (
      featureKey === FEATURE_KEYS.STAFF_ACCOUNTS ||
      (featureKey as string) === 'receptionist_accounts'
    ) {
      const result = await LimitationService.checkStaffLimit(clinicId);
      return sendOk(res, 'Staff limit check completed', result);
    }

    // Cloud storage capacity check
    if (featureKey === FEATURE_KEYS.CLOUD_STORAGE) {
      const incomingBytes = req.query.bytes
        ? parseInt(req.query.bytes as string, 10)
        : 0;
      const result = await LimitationService.checkStorageLimit(
        clinicId,
        incomingBytes
      );
      return sendOk(res, 'Cloud storage limit check completed', result);
    }

    // Boolean features
    const result = await LimitationService.isFeatureEnabled(
      clinicId,
      featureKey as FeatureKey
    );
    return sendOk(res, 'Feature availability check completed', result);
  }
);

/**
 * GET /api/v1/subscription/limitations/storage
 * Get cloud storage capacity, usage, and category permissions for the clinic
 */
export const getCloudStorageOverview = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const storage = await LimitationService.checkStorageLimit(clinicId, 0);
    const usedKB = await LimitationService.getStorageUsageKB(clinicId);

    return sendOk(res, 'Cloud storage overview fetched successfully', {
      usedKB,
      usedMB: storage.usedMB,
      limitMB: storage.limitMB,
      remainingMB: storage.remainingMB,
      percentage:
        storage.limitMB > 0
          ? Math.min(
              100,
              Math.round((storage.usedMB / storage.limitMB) * 1000) / 10
            )
          : 0,
      allowedCategories: storage.allowedCategories,
    });
  }
);

/**
 * GET /api/v1/users/limitations/storage-retention
 * Get storage retention months for the clinic
 */
export const getStorageRetention = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const months = await LimitationService.getStorageRetentionMonths(clinicId);

    return sendOk(res, 'Storage retention fetched successfully', {
      retentionMonths: months,
      isUnlimited: months === -1,
    });
  }
);

/**
 * GET /api/v1/users/limitations/payment-history-retention
 * Get payment history retention months for the clinic
 */
export const getPaymentHistoryRetention = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const months = await LimitationService.getPaymentHistoryMonths(clinicId);

    return sendOk(res, 'Payment history retention fetched successfully', {
      retentionMonths: months,
      isUnlimited: months === -1,
    });
  }
);

/**
 * POST /api/v1/subscription/limitations/enforce-staff-limits
 * Enforce staff limits for a clinic — deactivates excess staff/doctors.
 * Used by admin or cron job when a plan expires.
 * @access Super Admin or internal cron
 */
export const enforceStaffLimits = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId || req.body?.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'clinicId is required');
    }

    const result = await LimitationService.enforceStaffLimitsOnExpiry(clinicId);

    return sendOk(res, 'Staff limits enforced successfully', result);
  }
);

/**
 * POST /api/v1/subscription/limitations/reactivate-staff
 * Reactivate previously deactivated staff after a plan upgrade.
 * Called after a successful subscription upgrade.
 * @access Clinic Admin
 */
export const reactivateStaff = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await LimitationService.reactivateStaffOnUpgrade(clinicId);

    return sendOk(res, 'Staff reactivated successfully', {
      doctorsReactivated: result.doctorsReactivated,
      staffReactivated: result.staffReactivated,
    });
  }
);
