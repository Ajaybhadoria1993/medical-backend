/** How long one bill covers: a calendar month, or its two halves (1st-15th, 16th-end). */
export type CommissionPeriodKind = 'monthly' | 'half_monthly';

/** From `fromPatients` patients in a period, every patient costs `ratePaise`. */
export interface CommissionTier {
  fromPatients: number;
  ratePaise: number;
}

export interface CommissionPricing {
  periodKind: CommissionPeriodKind;
  /** Ascending by `fromPatients`; the first starts at 0. */
  tiers: CommissionTier[];
}

/** IST calendar dates as YYYY-MM-DD; `endDate` is the last day, `nextStartDate` the first day after. */
export interface CommissionPeriod {
  startDate: string;
  endDate: string;
  nextStartDate: string;
}

/** `clinic` = the clinic has its own pricing; `default` = the platform default applies. */
export type PricingSource = 'clinic' | 'default';

/** A stored pricing version, as the resolver reads it. */
export interface PricingVersionRow {
  clinicId: string | null;
  periodKind: CommissionPeriodKind | null;
  tiers: CommissionTier[] | null;
  effectiveFrom: Date;
}

export interface DoctorPatientCount {
  doctorId: string;
  name: string;
  patients: number;
}

export interface BilledAppointment {
  appointmentId: string;
  date: string;
  /** HH:mm for slot bookings; null for a token booking. */
  time: string | null;
  tokenNo: number | null;
  patientName: string | null;
  status: string;
  bookingSource: string;
}

export interface DoctorBill {
  doctorId: string;
  name: string;
  patients: number;
  ratePaise: number;
  amountPaise: number;
  /** The next cheaper rate and how many more patients reach it; null on the last tier. */
  nextTier: { atPatients: number; ratePaise: number; remaining: number } | null;
}

export interface CommissionOverview {
  period: CommissionPeriod & {
    isCurrent: boolean;
    previousDate: string;
    nextDate: string | null;
  };
  pricing: CommissionPricing & { source: PricingSource };
  doctors: DoctorBill[];
  totals: { patients: number; amountPaise: number };
}

export interface DoctorAppointmentsPage {
  period: CommissionPeriod;
  doctor: { id: string; name: string };
  total: number;
  items: BilledAppointment[];
}

/** One pricing scope (the platform default or one clinic) as Super Admin sees it. */
export interface PricingView {
  clinicId: string | null;
  source: PricingSource;
  inForce: CommissionPricing;
  /** A change waiting for the next period; null if none. */
  scheduled: (CommissionPricing & { effectiveFrom: string; followsDefault: boolean }) | null;
  history: {
    id: string;
    effectiveFrom: string;
    followsDefault: boolean;
    periodKind: CommissionPeriodKind | null;
    tiers: CommissionTier[] | null;
    reason: string;
    changedBy: string | null;
    createdAt: string;
  }[];
}

/** A clinic with its own pricing now or waiting to start; `current` null means it follows the default today. */
export interface ClinicPricingOverride {
  clinicId: string;
  clinicName: string;
  current: CommissionPricing | null;
  scheduled: {
    effectiveFrom: string;
    /** True when the change sends the clinic back to the platform default. */
    followsDefault: boolean;
    pricing: CommissionPricing | null;
  } | null;
}
