import { NextFunction, Request, Response } from 'express';
import { PermissionService } from '../main/permissions/services/permission.service';
import { PermissionKey } from '../main/permissions/utils/permission.constants';
import { asyncHandler, HttpError } from './errorHandler';

/**
 * Permission guard factory. Runs AFTER the plan gate (`requireFeature`) — a grant can
 * never unlock something the clinic's plan does not include.
 *
 * `restrictToRoles` scopes the check: only those roles are permission-checked, every
 * other role passes straight through. Keep a coarse role guard (`requireRole`) on the
 * route as well — this middleware does not gate the roles it skips.
 *
 * Usage:
 *   router.post('/x', requireAuth, requireReceptionist, requireClinic,
 *     requirePermission(PERMISSION_KEYS.APPOINTMENT_CREATE, ['Doctor']), controller)
 */
export const requirePermission = (
  permissionKey: PermissionKey,
  restrictToRoles?: string | string[]
) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Authentication required');

    if (user.userType === 'Super_Admin') return next();

    if (restrictToRoles) {
      const roles = Array.isArray(restrictToRoles)
        ? restrictToRoles
        : [restrictToRoles];
      if (!roles.includes(user.userType)) return next();
    }

    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(401, 'Clinic context required.');

    const allowed = await PermissionService.hasPermission(
      user.id,
      user.userType,
      clinicId,
      permissionKey
    );

    if (!allowed) {
      throw new HttpError(
        403,
        'You do not have permission to perform this action.'
      );
    }

    return next();
  });
