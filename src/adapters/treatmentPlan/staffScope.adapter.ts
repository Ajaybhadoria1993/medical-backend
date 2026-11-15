import { StaffScopeService } from '../../main/permissions/services/staffScope.service';
import type { StaffScopePort } from '../../main/treatmentPlan';

// The same rule appointments use, so a receptionist sees the same doctors on every screen.
export const staffScopeAdapter: StaffScopePort = {
  getAccessibleDoctorIds: (user, clinicId) =>
    StaffScopeService.getAccessibleDoctorIds(user, clinicId),
};
