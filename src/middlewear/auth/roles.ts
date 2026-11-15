// What the caller may do: role guards. Run after requireAuth.
import { NextFunction, Request, Response } from 'express';
import { asyncHandler, HttpError } from '../errorHandler';
import './types';

// ─── Role guards ─────────────────────────────────────────────────────────────
// Run after requireAuth. Listed widest to narrowest; each comment names exactly who passes.

/** Passes when the user's role is in `allowed`. usage: requireRole(['Admin', 'Doctor']).
 *  Special case: requireRole(['Doctor']) also admits an Admin with isAdminDoctorAccess. */
export const requireRole = (allowed: string | string[]) =>
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const roles = Array.isArray(allowed) ? allowed : [allowed];
    const user = req.user;
    if (!user) {
      throw new HttpError(401, 'Authentication required');
    }

    const isRoleAllowed = roles.includes(user.userType);

    const isAdminDoctorAllowed =
      user.userType === 'Admin' &&
      roles.length === 1 &&
      roles[0] === 'Doctor' &&
      user.isAdminDoctorAccess === true;
    if (!isRoleAllowed && !isAdminDoctorAllowed) {
      throw new HttpError(403, 'Insufficient role');
    }
    return next();
  });

/** Every staff role, i.e. `requireAdmin` without Patient. usage: requireRole(CLINIC_STAFF_ROLES). */
export const CLINIC_STAFF_ROLES = [
  'Admin',
  'Super_Admin',
  'Doctor',
  'Lab_Assistant',
  'Receptionist',
  'Nurse',
  'Pharmacist',
];

/** NOT admin-only despite the name: every app role, Patient included. */
export const requireAdmin = requireRole([
  'Admin',
  'Super_Admin',
  'Doctor',
  'Patient',
  'Lab_Assistant',
  'Receptionist',
  'Nurse',
  'Pharmacist',
]);

/** Clinic front desk and clinical staff: Admin, Super_Admin, Doctor, Receptionist, Nurse, Lab_Assistant. */
export const requireReceptionist = requireRole([
  'Admin',
  'Super_Admin',
  'Doctor',
  'Receptionist',
  'Nurse',
  'Lab_Assistant',
]);

/** Clinic staff without Nurse: Admin, Super_Admin, Doctor, Receptionist, Pharmacist, Lab_Assistant. */
export const requireUser = requireRole([
  'Admin',
  'Super_Admin',
  'Doctor',
  'Receptionist',
  'Pharmacist',
  'Lab_Assistant',
]);

/** Admin, Super_Admin, Pharmacist. */
export const requirePharmacist = requireRole([
  'Admin',
  'Super_Admin',
  'Pharmacist',
]);

/** Admin, Super_Admin, Lab_Assistant. */
export const requireLabAssistant = requireRole([
  'Admin',
  'Super_Admin',
  'Lab_Assistant',
]);

/** Doctor, plus an Admin with isAdminDoctorAccess (see requireRole). */
export const requireDoctor = requireRole(['Doctor']);

/** Patient only. */
export const requirePatient = requireRole(['Patient']);

/** Platform super admin only. */
export const requireSuperAdmin = requireRole(['Super_Admin']);
