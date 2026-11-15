/** Which doctors a staff member may see, under the clinic's staff assignments (Q9). */
export interface StaffScopePort {
  /** null = every doctor; [] = a receptionist assigned to nobody, who sees nothing. */
  getAccessibleDoctorIds(
    user: { id: string; userType: string },
    clinicId: string
  ): Promise<string[] | null>;
}
