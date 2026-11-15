/** One signed consent form on the patient's Medical Records; the file is signed on click via /files. */
export interface PatientConsentForm {
  /** appointment = uploaded on the appointment; plan = given when a treatment plan was accepted. */
  source: 'appointment' | 'plan';
  /** Appointment id or plan id, matching the files module's `consent` / `planConsent` types. */
  id: string;
  title: string;
  doctorName: string | null;
  date: Date | null;
}
