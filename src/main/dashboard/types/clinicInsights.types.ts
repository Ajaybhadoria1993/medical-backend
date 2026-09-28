export interface DoctorPerformanceItem {
  doctorId: string;
  doctor: string;
  appointments: number;
  completed: number;
  completionRate: number; // 0–100, one decimal
  revenue: number;
}

export type DuesBracket = '0-30' | '31-60' | '61-90' | '90+';

export interface OutstandingDuesItem {
  bracket: DuesBracket;
  amount: number;
  count: number;
}

export interface BusiestHourItem {
  hour: number; // 0–23
  label: string; // e.g. "9-10 AM"
  appointments: number;
}

export interface BusiestDayItem {
  day: string; // Mon…Sun
  appointments: number;
}

export type FollowUpGroup = 'within30' | '31-90' | '91-180' | '180+';

export interface FollowUpItem {
  group: FollowUpGroup;
  patients: number;
}

export interface ClinicInsights {
  /** Doctors assigned to the clinic who have ever had an appointment here. */
  doctorCount: number;
  hasAppointments: boolean;
  doctorPerformance: DoctorPerformanceItem[];
  outstandingDues: OutstandingDuesItem[];
  busiestHours: BusiestHourItem[];
  busiestDays: BusiestDayItem[];
  followUp: FollowUpItem[];
}
