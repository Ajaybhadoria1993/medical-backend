/** What the module reads about patients; implemented outside so it never imports users/patient. */
export interface PatientPort {
  /** The patient if they belong to the clinic (clinic_assign), else null. Allergies as recorded on the profile. */
  getClinicPatient(
    clinicId: string,
    patientId: string
  ): Promise<{ id: string; name: string; allergies: string[] } | null>;
  /** Names by patient id, for lists; ids with no user are left out. */
  getNames(patientIds: string[]): Promise<Map<string, string>>;
  /** Mobile per patient id: their own, else their in-clinic family contact's; missing when neither. */
  getMobiles(
    clinicId: string,
    patientIds: string[]
  ): Promise<Map<string, string>>;
  /** Ids of the clinic's patients whose name or mobile contains `q`, at most `limit`. */
  searchIds(clinicId: string, q: string, limit: number): Promise<string[]>;
}
