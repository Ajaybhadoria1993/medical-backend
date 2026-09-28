import { NextFunction, Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { PermissionService } from '../../permissions/services/permission.service';
import { PERMISSION_KEYS } from '../../permissions/utils/permission.constants';
import { isScopedStaffRole } from '../../permissions/utils/staffScope.utils';
import { isPayLaterMode as checkIsPayLaterMode } from '../utils/paymentMode.constants';

const PAYMENT_FIELDS = [
  'paymentMode',
  'paymentStatus',
  'price',
  'primaryServicePrice',
  'paymentNotes',
  'refundMode',
  'refundedAmount',
  'refundNotes',
] as const;

// The appointment create and update endpoints carry both clinical and payment
// fields, so the payment permission is decided from the payload.
export const requirePaymentPermissionForPayload = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !isScopedStaffRole(req.user.userType)) return next();

    const payload = req.validatedBody ?? req.body ?? {};
    const rawMode = String(payload.paymentMode || '')
      .trim()
      .toLowerCase();
    const rawStatus = String(payload.paymentStatus || '')
      .trim()
      .toLowerCase();

    const isPayLaterMode =
      checkIsPayLaterMode(rawMode) || rawMode === 'pay on visit';
    const isNonChargeable =
      rawMode === 'not required' ||
      rawStatus === 'free consultation' ||
      rawStatus === 'covered' ||
      rawStatus === 'pending';

    const touchesPaymentFields = PAYMENT_FIELDS.some(
      (field) => payload[field] !== undefined
    );

    if (!touchesPaymentFields) return next();

    // A create with no explicit mode/status is derived as 'Paid' by the service
    // (see appointment.service.ts — "no mode → Already Paid"), so an absent mode
    // on a payload that carries money fields still records a collected payment
    // and must be permission-checked rather than waved through.
    const isImplicitPaidCreate = !rawMode && !rawStatus;

    // If only booking with "Pay Later" or non-chargeable status with no refund/paid state,
    // this is not collecting or modifying payment, so allow it through.
    const isCollectingOrModifyingPayment =
      (rawMode && !isPayLaterMode && !isNonChargeable) ||
      isImplicitPaidCreate ||
      rawStatus === 'paid' ||
      rawStatus === 'refunded' ||
      payload.refundMode !== undefined ||
      payload.refundedAmount !== undefined ||
      payload.refundNotes !== undefined ||
      (req.method === 'PUT' &&
        (payload.price !== undefined || payload.paymentNotes !== undefined));

    if (!isCollectingOrModifyingPayment) return next();

    if (!req.clinicId) throw new HttpError(401, 'Clinic context required.');

    const allowed = await PermissionService.hasPermission(
      req.user.id,
      req.user.userType,
      req.clinicId,
      PERMISSION_KEYS.PAYMENT_MANAGE
    );

    if (!allowed) {
      throw new HttpError(
        403,
        'You do not have permission to collect or update payments.'
      );
    }

    return next();
  }
);

// A walk-in is not its own endpoint — it is a booking whose source says so, so
// the permission can only be decided from the payload.
export const requireWalkInPermissionForPayload = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !isScopedStaffRole(req.user.userType)) return next();

    const payload = req.validatedBody ?? req.body ?? {};
    if (payload.bookingSource !== 'walk_in') return next();

    if (!req.clinicId) throw new HttpError(401, 'Clinic context required.');

    const allowed = await PermissionService.hasPermission(
      req.user.id,
      req.user.userType,
      req.clinicId,
      PERMISSION_KEYS.APPOINTMENT_WALKIN
    );

    if (!allowed) {
      throw new HttpError(
        403,
        'You do not have permission to add walk-in patients.'
      );
    }

    return next();
  }
);
