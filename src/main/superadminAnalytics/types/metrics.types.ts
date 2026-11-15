/** Per-clinic activity facts the metric formulas need; counts only, never patient data. */
export interface ClinicFacts {
  clinicId: string;
  createdAt: Date;
  acquisitionSource: string;
  onboardingCompleted: boolean;
  /** clinics.status as stored (Pending, Active, Rejected, Blocked...). */
  accountStatus: string;
  deleted: boolean;
  /** First Completed appointment (IST wall clock, as stored). */
  firstValueAt: Date | null;
  /** Latest non-cancelled appointment on or before today. */
  lastActivityAt: Date | null;
  /** Non-cancelled appointments in the last 30 days and the 30 before that. */
  appointments30: number;
  appointmentsPrev30: number;
  /** Distinct days with a non-cancelled appointment in the last 30 days. */
  activeDays30: number;
  /** Razorpay Route status of the payout account (null = never started), its reason and last change. */
  payoutStatus?: string | null;
  payoutReason?: string | null;
  payoutChangedAt?: Date | null;
  /** Razorpay linked account id (acc_...), quoted in the support request; not secret. */
  payoutAccountId?: string | null;
}

/** One stretch of a clinic's subscription, normalised to a monthly value. */
export interface SubscriptionSpan {
  clinicId: string;
  startsAt: Date;
  expiresAt: Date | null;
  /** Price paid per month; yearly plans are divided by 12. 0 for free plans. */
  monthlyValue: number;
  isTrial: boolean;
  isPaid: boolean;
  /** The platform's free tier (slug solo/Free), unlike a paid plan made ₹0 by a coupon. */
  isFreePlan?: boolean;
  planName: string;
  /** A renewal of the same plan or an add-on: adds revenue but is not a new plan start. */
  continues?: boolean;
}

/** Business identity of a clinic; the clinic's own contact details, never a patient's. */
export type AccountStatus = 'Active' | 'Inactive' | 'Blocked' | 'Deleted';

export interface AccountStatusCounts {
  total: number;
  active: number;
  inactive: number;
  blocked: number;
  deleted: number;
}

export interface ClinicIdentity {
  clinicId: string;
  clinicCode: string;
  name: string;
  tagline: string | null;
  logo: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  acquisitionSource: string;
  /** Account status as Clinic Management shows it; a soft-deleted clinic reads 'Deleted'. */
  status: string;
  createdAt: Date;
}

/** One month of the Overview growth chart; counts only. */
export interface TrendPoint {
  month: string;
  mrr: number;
  paidClinics: number;
  registrations: number;
  appointments: number;
}

/** One subscription event for the Clinic 360° timeline; money amounts only, no card data. */
export interface SubscriptionEvent {
  type: string;
  title: string;
  description: string | null;
  amount: number | null;
  at: Date;
}

/** Platform-wide usage for IST days from..to; counts only, never patient or clinical detail. */
export interface UsageFacts {
  appointmentsByDay: { day: string; count: number; app: number }[];
  byStatus: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
  topClinics: { clinicId: string; count: number }[];
  /** Patients whose first-ever appointment falls in the range. */
  newPatients: number;
  clinicsWithBookings: number;
  staffByRole: { role: string; actions: number; people: number }[];
}

/** One tracked staff action; ids and names only, never request data (same rule as audit_log). */
export interface AuditRow {
  id: string;
  action: string;
  label: string;
  entityId: string | null;
  ip: string | null;
  createdAt: Date;
  clinicId: string;
  clinicCode: string | null;
  clinicName: string | null;
  userName: string | null;
  userRole: string | null;
}

export interface AuditFilters {
  clinicId?: string;
  /** Action prefix, e.g. 'appointment' for 'appointment.cancelled'. */
  type?: string;
  role?: string;
  /** IST days, inclusive. */
  from: string;
  to: string;
}

/** A signed-in staff device (one row per user per platform); never the token itself. */
export interface SessionRow {
  userId: string;
  userName: string | null;
  role: string;
  clinicName: string | null;
  clinicCode: string | null;
  platform: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: Date;
  expiresAt: Date;
}

/** Patient mobile app adoption for IST days from..to; counts only, never who the patients are. */
export interface PatientAppFacts {
  totalPatients: number;
  newPatientAccounts: number;
  /** Patients whose app sign-in is still valid, per phone type. */
  signedInApp: { android: number; ios: number };
  /** Distinct patients across both phone types (one person can be on two phones). */
  signedInPatients: number;
  /** Patients whose latest app sign-in happened in the dates. */
  appSignIns: number;
  /** Patients with a phone registered for push, per phone type. */
  pushEnabled: { android: number; ios: number };
  /** Distinct patients with at least one phone registered for push. */
  pushPatients: number;
  newPushDevices: number;
  appBookings: number;
  allBookings: number;
  appBookingsByDay: { day: string; count: number }[];
  allBookingsByDay: { day: string; count: number }[];
  topAppClinics: { clinicId: string; count: number }[];
}

/** Just enough to name a clinic in a list row. */
export interface ClinicLabel {
  clinicId: string;
  clinicCode: string;
  name: string;
}

/** A Super Admin user who can own follow-up tasks. */
export interface AdminUser {
  id: string;
  name: string;
}

export type ClinicStage =
  | 'Registered'
  | 'SetupDone'
  | 'FirstValue'
  | 'Active'
  | 'Declining'
  | 'Dormant'
  | 'Churned';

export interface MrrBridge {
  opening: number;
  newMrr: number;
  expansion: number;
  contraction: number;
  churned: number;
  closing: number;
}

/** Money actually received in a period, kept apart from MRR (MRR ≠ collected). */
export interface CollectedMoney {
  /** Net of refunds, from subscription_payments. */
  subscriptions: number;
  subscriptionPayments: number;
  subscriptionRefunds?: number;
  /** MediArogya's own earning from online bookings: convenience fee + commission (ledger). */
  bookingFees: number;
  bookingFeePayments: number;
  /** GST and the gateway fee pass through to the government and Razorpay. */
  bookingFeeSplit: {
    convenience: number;
    commission: number;
    gst: number;
    gatewayFee: number;
  };
  topFeeClinics: { clinicId: string; clinicName: string; fees: number }[];
}

export interface FailedPayment {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  amount: number;
  at: Date;
  /** Bank's reason, and whether it was an AutoPay try. */
  reason?: string | null;
  autoPay?: boolean;
}

/** AutoPay and Razorpay-match figures for Revenue and the Attention list. */
export interface BillingHealth {
  autoPay: {
    active: number;
    paused: number;
    cancelled: number;
    charges: {
      paid: number;
      paidAmount: number;
      pending: number;
      failed: number;
    };
    pastDue: number;
  };
  razorpayMatch: {
    openDifferences: number;
    ourTotal: number;
    lastWebhookAt: Date | null;
  };
}

/** How many clinics made each MRR move; pairs with the bridge's amounts. */
export interface MovementCounts {
  newPaid: number;
  upgrades: number;
  downgrades: number;
  churned: number;
}

export interface PlanMixRow {
  planName: string;
  clinics: number;
  mrr: number;
  /** Share of total MRR, 0–100, one decimal. */
  share: number;
}

export interface SourceRow {
  source: string;
  registered: number;
  firstValue: number;
  paid: number;
  mrr: number;
}

/** Days from registration to First Value, for clinics registered in the period. */
export interface TimeToFirstValue {
  medianDays: number | null;
  underOneDay: number;
  oneToThree: number;
  threeToSeven: number;
  overSeven: number;
  notYet: number;
}

/** Cohort funnel: clinics registered in the period and how far each got. */
export interface Funnel {
  registered: number;
  setupDone: number;
  firstValue: number;
  active: number;
  paid: number;
}

export interface Conversion {
  converted: number;
  eligible: number;
  /** 0–100, one decimal; 0 when nobody was eligible. */
  rate: number;
}
