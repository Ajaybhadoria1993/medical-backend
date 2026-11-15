import type {
  AccountStatusCounts,
  AuditRow,
  BillingHealth,
  ClinicIdentity,
  ClinicStage,
  CollectedMoney,
  Conversion,
  FailedPayment,
  Funnel,
  MovementCounts,
  MrrBridge,
  PlanMixRow,
  SessionRow,
  SourceRow,
  TimeToFirstValue,
  TrendPoint,
} from './metrics.types';

export interface RevenueResponse {
  period: Period;
  previousPeriod: Period;
  mrr: number;
  mrrPrevious: number;
  /** Average MRR per paying clinic at period end. */
  arpc: number;
  mrrBridge: MrrBridge;
  movement: MovementCounts;
  collected: CollectedMoney & { total: number };
  planMix: PlanMixRow[];
  failedPayments: FailedPayment[];
  /** AutoPay and Razorpay-match cards. */
  billing: BillingHealth;
  generatedAt: string;
}

/** One row per plan: clinics on it today by billing, and the soonest trial end on it. */
export interface PlanUsageRow {
  planName: string;
  paid: number;
  trial: number;
  free: number;
  total: number;
  nextTrialEndsOn: string | null;
  nextTrialDaysLeft: number | null;
}

export interface AuditListResponse {
  period: Period;
  items: Array<Omit<AuditRow, 'createdAt'> & { createdAt: string }>;
  total: number;
  pageNumber: number;
  pageSize: number;
  /** Action families for the filter, e.g. 'appointment'. */
  types: string[];
}

export interface SessionListResponse {
  items: Array<
    Omit<SessionRow, 'userAgent' | 'signedInAt' | 'expiresAt'> & {
      device: string;
      signedInAt: string;
      expiresAt: string;
      active: boolean;
    }
  >;
  total: number;
  pageNumber: number;
  pageSize: number;
}

export interface PatientAppResponse {
  period: Period;
  previousPeriod: Period;
  kpis: {
    totalPatients: number;
    /** Patients whose app sign-in is still valid now. */
    signedInApp: number;
    signedInShare: number;
    appSignIns: number;
    appSignInsPrevious: number;
    appBookings: number;
    appBookingsPrevious: number;
    /** % of all bookings in the dates. */
    appBookingShare: number;
    pushEnabled: number;
    newPatientAccounts: number;
  };
  signedInByPlatform: { android: number; ios: number };
  pushByPlatform: { android: number; ios: number };
  newPushDevices: number;
  /** Every day in the dates: bookings made in the app and all bookings. */
  bookingsByDay: { day: string; app: number; all: number }[];
  topAppClinics: {
    clinicId: string;
    clinicCode: string;
    name: string;
    count: number;
  }[];
  generatedAt: string;
}

export interface UsageResponse {
  period: Period;
  previousPeriod: Period;
  kpis: {
    appointments: number;
    appointmentsPrevious: number;
    /** % of all appointments in the dates. */
    completedRate: number;
    noShowRate: number;
    newPatients: number;
    newPatientsPrevious: number;
    clinicsWithBookings: number;
    staffActions: number;
  };
  appointmentsByDay: { day: string; count: number; app: number }[];
  byStatus: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
  topClinics: {
    clinicId: string;
    clinicCode: string;
    name: string;
    count: number;
  }[];
  staffByRole: { role: string; actions: number; people: number }[];
  generatedAt: string;
}

export interface GrowthResponse {
  period: Period;
  previousPeriod: Period;
  registrations: number;
  registrationsPrevious: number;
  funnel: Funnel;
  /** Setup done and First Value as % of the period's registrations. */
  setupRate: number;
  firstValueRate: number;
  freeToPaid: Conversion;
  trialToPaid: Conversion;
  timeToFirstValue: TimeToFirstValue;
  sources: SourceRow[];
  plans: PlanUsageRow[];
  generatedAt: string;
}

export type BillingStatus = 'Paid' | 'Trial' | 'Free';

export interface Period {
  from: string;
  to: string;
}

export interface OverviewResponse {
  period: Period;
  previousPeriod: Period;
  kpis: {
    mrr: number;
    mrrPrevious: number;
    paidClinics: number;
    paidClinicsPrevious: number;
    activePaidClinics: number;
    newRegistrations: number;
    newRegistrationsPrevious: number;
    freeToPaid: Conversion;
    trialToPaid: Conversion;
    lostMrr: number;
  };
  mrrBridge: MrrBridge;
  /** Jan to this month of the current year. */
  trend: TrendPoint[];
  /** Clinics on a free trial now; `endingFirst` is the 5 ending soonest. */
  /** Clinics per current plan, split paid / trial / free. */
  plans: Array<{
    planName: string;
    paid: number;
    trial: number;
    free: number;
    total: number;
  }>;
  trials: {
    total: number;
    endingFirst: Array<{
      clinicId: string;
      clinicCode: string;
      name: string;
      planName: string;
      endsOn: string;
      daysLeft: number;
    }>;
  };
  funnel: Funnel;
  stages: Record<ClinicStage, number>;
  attention: {
    paidDormant: number;
    declining: number;
    setupStuck: number;
    noFirstValue: number;
    /** Clinics whose payout account is stuck (Razorpay needs a change, paused or locked). */
    payoutBlocked: number;
    /** Billing items, read live: open Razorpay differences, past-due plans, quiet webhook. */
    billingDifferences?: number;
    pastDue?: number;
    webhookQuiet?: boolean;
  };
  generatedAt: string;
}

export interface ClinicRow extends ClinicIdentity {
  stage: ClinicStage;
  billing: BillingStatus;
  planName: string | null;
  /** Last day of the running trial (IST, YYYY-MM-DD) and whole days left; null when not on a trial. */
  trialEndsOn: string | null;
  trialDaysLeft: number | null;
  mrr: number;
  appointments30: number;
  appointmentsPrev30: number;
  lastActivityAt: Date | null;
}

export interface ClinicListResponse {
  /** Whole managed set, ignoring search and filters (as Clinic Management shows it). */
  stats: AccountStatusCounts;
  /** Filter options: distinct cities and states in the managed set. */
  locations: { cities: string[]; states: string[] };
  items: ClinicRow[];
  pageNumber: number;
  pageSize: number;
  total: number;
}

/** One Clinic 360° timeline entry: a subscription event or an Action Center note. */
export interface ClinicTimelineItem {
  id: string;
  at: string;
  source: 'subscription' | 'followup';
  /** subscription_activity type, or the follow-up note kind. */
  kind: string;
  title: string;
  detail: string | null;
  amount: number | null;
  /** Super Admin who did it; null for system and clinic-side events. */
  actor: string | null;
  /** Follow-up problem type, for follow-up entries. */
  taskType: string | null;
}

export interface ClinicTimelineResponse {
  items: ClinicTimelineItem[];
  /** Staff actions in the audit log, so the timeline shows whether the clinic is really using the app. */
  staffActivity: { days: number; actions: number; lastAt: string | null };
}

export interface ClinicSummaryResponse extends ClinicRow {
  firstValueAt: Date | null;
  activeDays30: number;
  firstPaidAt: Date | null;
}
