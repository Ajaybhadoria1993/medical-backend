/** What the module reads about a doctor; implemented outside so it never imports users/doctor. */
export interface DoctorPort {
  /** Main speciality plus every specialization, as saved; empty when none is set. */
  getSpecialties(doctorId: string): Promise<string[]>;
}
