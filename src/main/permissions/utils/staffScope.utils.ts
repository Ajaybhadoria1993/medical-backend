import { eq, inArray, or, sql, SQL } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

// Roles whose reach over clinic data is decided by a doctor assignment. Adding
// a role here is all it takes to bring it under the same rules — the schema and
// every enforcement point are already role-neutral. Entries must exist in the
// user_type enum, so a new role (Manager) joins here once the enum has it.
export const SCOPED_STAFF_ROLES = ['Receptionist', 'Nurse'] as const;

export type ScopedStaffRole = (typeof SCOPED_STAFF_ROLES)[number];

// Roles that see the whole clinic regardless of any assignment. Doctor is not
// here: a doctor is already scoped to themselves by the queries serving them.
export const UNRESTRICTED_ROLES = new Set(['Admin', 'Super_Admin']);

export const isScopedStaffRole = (userType: string): boolean =>
  (SCOPED_STAFF_ROLES as readonly string[]).includes(userType);

export const doctorCondition = or(
  eq(UserModel.userType, 'Doctor'),
  eq(UserModel.isAdminDoctorAccess, true)
);

// `null` (unrestricted) and `[]` (assigned to nobody) are opposites, so they
// must never collapse to the same cache key.
export const scopeCacheKey = (doctorIds: string[] | null): string => {
  if (doctorIds === null) return 'all';
  if (!doctorIds.length) return 'none';
  return [...doctorIds].sort().join(',');
};

// `[]` must produce a filter that matches nothing. An empty `inArray` is not
// valid SQL, and omitting the clause would widen the query to the whole clinic.
export const doctorScopeFilter = (
  column: PgColumn,
  allowedDoctorIds: string[] | null
): SQL | undefined => {
  if (allowedDoctorIds === null) return undefined;
  if (!allowedDoctorIds.length) return sql`false`;
  return inArray(column, allowedDoctorIds);
};
