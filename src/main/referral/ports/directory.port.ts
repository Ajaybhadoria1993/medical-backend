/** Names the module shows beside referrals; read only. */
export interface DirectoryPort {
  /** Names by user id; ids with no user are left out. */
  getUserNames(userIds: string[]): Promise<Map<string, string>>;
  /** Roles (userType) by user id; ids with no user are left out. */
  getUserRoles(userIds: string[]): Promise<Map<string, string>>;
  /** Names by clinic id; ids with no clinic are left out. */
  getClinicNames(clinicIds: string[]): Promise<Map<string, string>>;
}
