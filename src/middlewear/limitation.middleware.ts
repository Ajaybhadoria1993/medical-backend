// src/middlewear/limitation.middleware.ts
import { NextFunction, Request, Response } from 'express';
import { asyncHandler, HttpError } from './errorHandler';
import {
  FeatureKey,
  FEATURE_KEYS,
  LimitationService,
  STAFF_USER_TYPES,
  StaffUserType,
} from '../main/subscription/services/limitation.service';

/**
 * Middleware: Require a boolean feature to be enabled on the clinic's plan
 *
 * Usage:
 *   router.use(requireFeature(FEATURE_KEYS.LAB_INTEGRATION))
 */
export const requireFeature = (featureKey: FeatureKey) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const result = await LimitationService.isFeatureEnabled(
      clinicId,
      featureKey
    );

    if (!result.allowed) {
      throw new HttpError(
        403,
        result.message || 'Feature not available on your current plan.'
      );
    }

    return next();
  });

/**
 * Middleware: Check usage-based limit before allowing action
 * Does NOT increment usage — call incrementUsage() in your controller after success.
 *
 * Usage:
 *   router.post('/send', requireUsageLimit(FEATURE_KEYS.WHATSAPP_MESSAGES), controller)
 */
export const requireUsageLimit = (featureKey: FeatureKey) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const result = await LimitationService.checkUsageLimit(
      clinicId,
      featureKey
    );

    if (!result.allowed) {
      throw new HttpError(
        429,
        result.message || 'You have reached your plan limit for this feature.'
      );
    }

    // Attach usage info to request for controllers to use
    req.usageLimitInfo = {
      featureKey,
      currentUsage: result.currentUsage,
      limit: result.limit,
      remaining: result.remaining,
      isUnlimited: result.isUnlimited,
    };

    return next();
  });

/**
 * Middleware: Check doctor account limit before adding a new doctor
 *
 * Usage:
 *   router.post('/doctors', requireDoctorLimit, addDoctorController)
 */
export const requireDoctorLimit = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const result = await LimitationService.checkDoctorLimit(clinicId);

    if (!result.allowed) {
      throw new HttpError(
        403,
        result.message || 'Doctor account limit reached on your current plan.'
      );
    }

    return next();
  }
);

/**
 * Middleware: Check receptionist account limit before adding a new receptionist
 * @deprecated Use requireStaffLimit instead — receptionists are part of the unified staff limit
 *
 * Usage:
 *   router.post('/receptionists', requireReceptionistLimit, addReceptionistController)
 */
export const requireReceptionistLimit = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const result = await LimitationService.checkStaffLimit(clinicId);

    if (!result.allowed) {
      throw new HttpError(
        403,
        result.message || 'Staff account limit reached on your current plan.'
      );
    }

    return next();
  }
);

/**
 * Middleware: Check unified staff account limit before adding any staff member.
 * Covers: Receptionist, Nurse, Pharmacist, Lab_Assistant, Radiologist
 *
 * Usage:
 *   router.post('/staff', requireStaffLimit, addStaffController)
 */
export const requireStaffLimit = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const result = await LimitationService.checkStaffLimit(clinicId);

    if (!result.allowed) {
      throw new HttpError(
        403,
        result.message || 'Staff account limit reached on your current plan.'
      );
    }

    return next();
  }
);

/**
 * Middleware: Dynamically check doctor/staff limit based on userType in body.
 * Used on the generic /adduser route that handles multiple user types.
 *
 * Enforcement rules:
 * - Doctor → checkDoctorLimit()
 * - All staff types (Receptionist, Nurse, Pharmacist, Lab_Assistant, Radiologist) → checkStaffLimit()
 * - Lab_Assistant → additionally requires lab_integration feature
 * - Pharmacist → additionally requires pharmacy_integration feature
 *
 * Usage:
 *   router.post('/adduser', validate(schema, 'body'), requireAddUserLimit, controller)
 */
export const requireAddUserLimit = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required.');
    }

    const userType =
      req.body?.userType || (req as Request).validatedBody?.userType;

    // Doctor limit check
    if (userType === 'Doctor') {
      const result = await LimitationService.checkDoctorLimit(clinicId);
      if (!result.allowed) {
        throw new HttpError(
          403,
          result.message || 'Doctor account limit reached on your current plan.'
        );
      }
      return next();
    }

    // All staff types share the unified staff limit
    if (STAFF_USER_TYPES.includes(userType as StaffUserType)) {
      // 1. Check feature prerequisites (Lab_Assistant needs lab_integration, Pharmacist needs pharmacy_integration)
      const prerequisiteCheck =
        await LimitationService.checkStaffFeaturePrerequisite(
          clinicId,
          userType
        );

      if (!prerequisiteCheck.allowed) {
        throw new HttpError(
          403,
          prerequisiteCheck.message ||
            `Your current plan does not support adding ${userType.replace('_', ' ')} users. Please upgrade your plan.`
        );
      }

      // 2. Check unified staff account limit
      const staffResult = await LimitationService.checkStaffLimit(clinicId);
      if (!staffResult.allowed) {
        throw new HttpError(
          403,
          staffResult.message ||
            'Staff account limit reached on your current plan.'
        );
      }
    }

    return next();
  }
);

/**
 * Middleware: Enforce date range based on plan's storage/history retention
 * Blocks requests where startDate is older than the allowed retention period.
 *
 * @param featureKey - Which retention limit to check (STORAGE_MONTHS or PAYMENT_HISTORY_MONTHS)
 *
 * Usage:
 *   router.get('/appointments', enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS), controller)
 *   router.get('/payments', enforceDateLimit(FEATURE_KEYS.PAYMENT_HISTORY_MONTHS), controller)
 */
export const enforceDateLimit = (featureKey: FeatureKey) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      // No clinic context — skip enforcement
      return next();
    }

    const plan = await LimitationService.getClinicActivePlan(clinicId);

    if (!plan) {
      // No plan configured — skip enforcement
      return next();
    }

    const limit = await LimitationService.getPlanLimit(plan.planId, featureKey);

    if (!limit || !limit.enabled || limit.isUnlimited) {
      // Unlimited or not configured — allow all dates
      return next();
    }

    const retentionMonths = limit.limitValue;

    if (!retentionMonths) {
      return next();
    }

    // Calculate the earliest allowed date
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
    cutoffDate.setHours(0, 0, 0, 0);

    // Check startDate from query params
    const startDateParam =
      (req.query.startDate as string) ||
      (req.query.from as string) ||
      (req.query.date as string);

    if (startDateParam) {
      const requestedDate = new Date(startDateParam);

      if (!isNaN(requestedDate.getTime()) && requestedDate < cutoffDate) {
        throw new HttpError(
          403,
          `Your ${plan.planSlug} plan only allows access to the last ${retentionMonths} month(s) of data. Please upgrade to access older records.`
        );
      }
    }

    // Attach cutoff date to request so controllers can use it for filtering
    req.planDateCutoff = cutoffDate;

    return next();
  });

/**
 * Middleware: Enforce cloud storage capacity quota.
 * Checks remaining storage limit before allowing upload.
 *
 * Usage:
 *   router.post('/upload', requireAuth, requireClinic, enforceStorageQuota, upload, controller)
 */
export const enforceStorageQuota = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      return next();
    }

    // Estimate file size if content-length header is available
    const contentLength = req.headers['content-length']
      ? parseInt(req.headers['content-length'], 10)
      : 0;

    const storageCheck = await LimitationService.checkStorageLimit(
      clinicId,
      contentLength
    );

    if (!storageCheck.allowed) {
      throw new HttpError(
        403,
        storageCheck.message ||
          'Cloud storage limit reached for your clinic. Please upgrade your plan or purchase an Additional Storage add-on.'
      );
    }

    return next();
  }
);

// Re-export feature keys for convenience
export { FEATURE_KEYS };

// Extend Express Request type
declare module 'express' {
  interface Request {
    usageLimitInfo?: {
      featureKey: string;
      currentUsage: number;
      limit: number | null;
      remaining: number | null;
      isUnlimited: boolean;
    };
    /** Earliest date allowed by the plan's retention limit */
    planDateCutoff?: Date;
  }
}
