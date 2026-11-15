import type { TreatmentPlanSettings } from '../models/treatmentPlanSettings.model';

/** What GET and PUT /settings return: the settings only, no ids or timestamps. */
export type TreatmentPlanSettingsView = Pick<
  TreatmentPlanSettings,
  | 'billingModes'
  | 'invoiceTiming'
  | 'discountCapPercent'
  | 'bookingMode'
  | 'bookingHorizonDays'
  | 'recallReminderDays'
  | 'instalmentReminderDays'
  | 'packageExpiryReminderDays'
>;
