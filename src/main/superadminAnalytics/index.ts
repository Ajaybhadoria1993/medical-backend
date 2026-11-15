// Public surface of the module: code outside main/superadminAnalytics imports only from here.
export {
  registerSourceDataPort,
  registerWhatsAppMessagesPort,
  registerPlatformFeesPort,
} from './ports';
export type {
  SourceDataPort,
  WhatsAppMessagesPort,
  PlatformFeesPort,
} from './ports';
export type { PlatformWhatsAppMessage } from './types/whatsappMessages.types';
export type {
  AccountStatus,
  AdminUser,
  ClinicLabel,
  AuditFilters,
  AuditRow,
  PatientAppFacts,
  SessionRow,
  SubscriptionEvent,
  UsageFacts,
  AccountStatusCounts,
  ClinicFacts,
  ClinicIdentity,
  CollectedMoney,
  FailedPayment,
  SubscriptionSpan,
} from './types/metrics.types';

import { FollowupsService } from './services/followups.service';
import { SpecialtyOrderService } from './services/specialtyOrder.service';

/** Specialty catalog in the Super Admin's saved order; never throws. */
export const getOrderedSpecialtyCatalog = () =>
  SpecialtyOrderService.orderedCatalog();

/** Nightly Action Center sync, for the cron; idempotent, safe to rerun. */
export const runFollowupRules = () => FollowupsService.runRules();
