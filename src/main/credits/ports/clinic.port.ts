/** Names the module shows on Super Admin screens; read only. */
export interface ClinicPort {
  /** Names by clinic id; ids with no clinic are left out. */
  getClinicNames(clinicIds: string[]): Promise<Map<string, string>>;
  /** Names by user id, for "changed by"; ids with no user are left out. */
  getUserNames(userIds: string[]): Promise<Map<string, string>>;
}
