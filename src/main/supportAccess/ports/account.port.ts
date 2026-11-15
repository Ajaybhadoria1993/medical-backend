import type { StaffMember } from '../types/supportAccess.types';

/** User and clinic membership lookups the module needs; read only. */
export interface AccountPort {
  /** Null when the user does not exist. */
  getUser(userId: string): Promise<StaffMember | null>;
  /** The clinic the user works in, resolved the same way requireClinic does. */
  getUserClinicId(userId: string, userType: string): Promise<string | null>;
  /** Names by user id; ids with no user are left out. */
  getUserNames(userIds: string[]): Promise<Map<string, string>>;
}
