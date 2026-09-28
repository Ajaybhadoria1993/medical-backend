/**
 * Everything the module needs to know about people and clinics, behind one
 * port so no Drizzle model from another feature is imported here (A5).
 */

export interface NotificationUser {
  id: string;
  name: string;
  userType: string;
}

/** Whether a clinic has enabled each outbound channel. */
export interface ChannelSettings {
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

export interface AppointmentContext {
  patientName: string;
  doctorName: string;
  patientMobile: string | null;
  clinicName: string | null;
  /** Schedule, so copy can state when rather than telling the reader to open it. */
  appointmentDate: Date | string | null;
  appointmentTime: string | null;
  tokenNo: number | null;
}

export interface DirectoryPort {
  getUser(userId: string): Promise<NotificationUser | null>;

  /** Staff responsible for this doctor — the reverse lookup
   *  idx_staff_doctor_by_doctor exists for. */
  getStaffResponsibleForDoctor(
    clinicId: string,
    doctorId: string | null
  ): Promise<NotificationUser[]>;

  /** Every user holding one of these roles in a clinic. Prefer the scoped lookup above. */
  getStaffByRole(
    clinicId: string,
    roles: string[]
  ): Promise<NotificationUser[]>;

  /**
   * Filters a candidate list down to those holding a permission in a clinic.
   * This is how "do not notify users who cannot take action" is enforced.
   */
  filterByPermission(
    userIds: string[],
    clinicId: string,
    permissionKey: string
  ): Promise<string[]>;

  /** Lab staff attached to a clinic, from user_lab_assignments. */
  getLabUsers(clinicId: string): Promise<NotificationUser[]>;

  /**
   * Platform administrators. Not a clinic lookup: Super_Admins belong to no
   * clinic, so the staff-scope path cannot reach them.
   */
  getSuperAdmins(): Promise<NotificationUser[]>;

  /** Mobile numbers for WhatsApp, batched — one lookup per fan-out, not per
   *  recipient. Users without one are absent from the map. */
  getUserMobiles(userIds: string[]): Promise<Map<string, string>>;

  getClinicChannelSettings(clinicId: string): Promise<ChannelSettings | null>;

  /**
   * Resolved at send time rather than passed down from the caller: a queued
   * reminder may fire hours after scheduling, by which point the appointment
   * could have been reassigned to a different doctor.
   */
  getAppointmentContext(
    appointmentId: string
  ): Promise<AppointmentContext | null>;
}
