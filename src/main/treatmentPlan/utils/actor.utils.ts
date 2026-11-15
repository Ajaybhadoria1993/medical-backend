import type { AuthUser } from '../../../middlewear/auth.middleware';
import type { Actor } from '../types/template.types';

/** Same rule as requireRole(['Doctor']): an Admin with doctor access counts as a doctor. */
export const toActor = (user: AuthUser): Actor => ({
  id: user.id,
  userType: user.userType,
  isDoctor:
    user.userType === 'Doctor' ||
    (user.userType === 'Admin' && user.isAdminDoctorAccess === true),
});
