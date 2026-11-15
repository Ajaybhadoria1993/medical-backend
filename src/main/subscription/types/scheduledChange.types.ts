/** Stored on `subscriptions.scheduled_staff_change` until the scheduled change applies or is undone. */
export interface ScheduledStaffChange {
  keepDoctorIds: string[];
  keepStaffIds: string[];
  /** Told they lose access on the change date; told again if it is undone. */
  noticeUserIds: string[];
  noticeEventId: string;
  /** The clinic picked exactly who stays: noticeUserIds are switched off on the change date. */
  exact?: boolean;
}
