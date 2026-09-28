import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { CancellationPolicyService } from '../services/cancellationPolicy.service';
import { CANCELLATION_REASONS } from '../constants/reasons';
import { DEFAULT_CLINIC_POLICY } from '../constants/defaultPolicy';
import {
  updateClinicCancellationPolicySchema,
  requestCancellationSchema,
} from '../schemas/cancellationPolicy.schemas';

/**
 * Gets the static cancellation reasons master list.
 */
export const getReasonsController = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'Cancellation reasons retrieved successfully',
      CANCELLATION_REASONS
    );
  }
);

/**
 * Gets a clinic's cancellation policy.
 */
export const getClinicPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const policy = await CancellationPolicyService.getClinicPolicy(clinicId);
    return sendOk(
      res,
      'Clinic cancellation policy retrieved successfully',
      policy
    );
  }
);

/**
 * Updates or creates a new clinic policy version (Option B).
 */
export const updateClinicPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const payload = updateClinicCancellationPolicySchema.parse(
      req.validatedBody || req.body
    );

    const policy = await CancellationPolicyService.updateClinicPolicy(
      clinicId,
      payload
    );
    return sendOk(
      res,
      'Clinic cancellation policy updated successfully',
      policy
    );
  }
);

/**
 * Staff-initiated appointment cancellation.
 */
export const cancelAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const userId = req.user.id as string;
    const userRole = req.user.userType as string; // 'Doctor', 'Receptionist', 'Admin', etc.
    const payload = requestCancellationSchema.parse(
      req.validatedBody || req.body
    );

    const result = await CancellationPolicyService.processCancellationRequest(
      appointmentId,
      userId,
      userRole,
      payload,
      req.clinicId
    );

    return sendOk(res, result.message, result);
  }
);

/**
 * Gets the platform's default clinic cancellation policy values.
 */
export const getDefaultPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'Default cancellation policy settings retrieved successfully',
      DEFAULT_CLINIC_POLICY
    );
  }
);
