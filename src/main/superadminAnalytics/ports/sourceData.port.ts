import type {
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
  BillingHealth,
  CollectedMoney,
  FailedPayment,
  SubscriptionSpan,
} from '../types/metrics.types';
import type {
  PayoutAccountsFilter,
  PayoutAccountsPage,
} from '../types/payoutAccounts.types';

/** Everything the module reads from other features, so no foreign Drizzle model is imported here. */
export interface SourceDataPort {
  /** One row per clinic, activity windows measured back from `today` (IST, YYYY-MM-DD). */
  getClinicFacts(today: string): Promise<ClinicFacts[]>;
  /** Every subscription row, paid or not, for MRR and conversion history. */
  getSubscriptionSpans(): Promise<SubscriptionSpan[]>;
  /**
   * Managed clinics (same set as Clinic Management) matching `q`, best match first.
   * Deleted clinics appear only when `status` is 'Deleted'.
   */
  searchClinics(
    q: string | undefined,
    filters: { status?: AccountStatus; city?: string; state?: string },
    limit: number
  ): Promise<ClinicIdentity[]>;
  /** Distinct cities and states in the managed set, for the list's filter dropdowns. */
  getLocationOptions(): Promise<{ cities: string[]; states: string[] }>;
  /** Counts over the whole managed set, ignoring search and filters. */
  countByAccountStatus(): Promise<AccountStatusCounts>;
  getClinicIdentity(clinicId: string): Promise<ClinicIdentity | null>;
  /** Name + MED-ID for the given clinics (deleted ones included), in no order. */
  getClinicLabels(clinicIds: string[]): Promise<ClinicLabel[]>;
  /** Non-cancelled appointments per month (YYYY-MM) from `fromYmd` on, all clinics. */
  getMonthlyAppointments(
    fromYmd: string
  ): Promise<{ month: string; count: number }[]>;
  /** Tracked staff actions at a clinic in the last `days` days, and when the latest happened. */
  getStaffActivity(
    clinicId: string,
    days: number
  ): Promise<{ actions: number; lastAt: Date | null }>;
  /** Appointment, patient and staff-activity counts for IST days `from`–`to` inclusive. */
  getUsage(from: string, to: string): Promise<UsageFacts>;
  /** Tracked staff actions across clinics, newest first, one page. */
  listAudit(
    filters: AuditFilters,
    limit: number,
    offset: number
  ): Promise<{ items: AuditRow[]; total: number; types: string[] }>;
  /** Signed-in staff devices (patients excluded), newest sign-in first, one page. */
  listSessions(
    filters: { q?: string; platform?: string; activeOnly: boolean },
    limit: number,
    offset: number
  ): Promise<{ items: SessionRow[]; total: number }>;
  /** Patient app adoption and app bookings for IST days `from`–`to`; counts only. */
  getPatientApp(from: string, to: string): Promise<PatientAppFacts>;
  /** Ends every session of one clinic staff member at once; null if not a staff account. */
  signOutEverywhere(
    userId: string
  ): Promise<{ name: string; role: string } | null>;
  /** A clinic's subscription events, newest first. */
  getSubscriptionEvents(
    clinicId: string,
    limit: number
  ): Promise<SubscriptionEvent[]>;
  /** The user who owns (signed up) the clinic, with a display name; null if the clinic is gone. */
  getClinicOwner(clinicId: string): Promise<AdminUser | null>;
  /** Super Admin users, the only people who can own a follow-up task. */
  getSuperAdmins(): Promise<AdminUser[]>;
  /** Money received and subscription payments that failed, IST days `from`–`to` inclusive. */
  getMoney(
    from: string,
    to: string
  ): Promise<{ collected: CollectedMoney; failed: FailedPayment[] }>;
  /** AutoPay and Razorpay-match figures, IST days `from`–`to` inclusive. */
  getBillingHealth(from: string, to: string): Promise<BillingHealth>;
  /** One page of live clinics' payout status (masked bank only), filtered and searched in SQL. */
  getPayoutAccounts(filter: PayoutAccountsFilter): Promise<PayoutAccountsPage>;
}
