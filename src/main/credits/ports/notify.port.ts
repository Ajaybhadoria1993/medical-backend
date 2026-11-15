import type { ExpiryAlert, UsageAlert } from '../types/credits.types';

/** Alerts to a clinic's admins; implemented outside so this module never imports notifications. */
export interface NotifyPort {
  usageWarning(alert: UsageAlert): Promise<void>;
  usagePaused(alert: UsageAlert): Promise<void>;
  creditsExpiring(alert: ExpiryAlert): Promise<void>;
}
