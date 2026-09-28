export interface StaffMetricItem {
  value: number;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral' | 'new';
}

export interface StaffMetrics {
  totalStaff: StaffMetricItem;
  activeStaff: StaffMetricItem;
  appointmentsHandled: StaffMetricItem;
  completedAppointments: StaffMetricItem;
  avgAppointmentsPerDoctor: StaffMetricItem;
  completionRate: StaffMetricItem;
}

export interface StaffTrend {
  labels: string[];
  currentPeriod: number[];
  previousPeriod: number[];
}

export interface StaffDistributionItem {
  label: string;
  value: number;
  percentage: number;
}

export interface StaffPerformanceItem {
  staffId: string;
  staffName: string;
  role: string;
  appointments: number;
  completed: number;
  completionRate: number;
}

export interface StaffWorkloadItem {
  staffId: string;
  staffName: string;
  role: string;
  appointments: number;
  shareOfClinic: number;
}

export interface ReportsStaffData {
  metrics: StaffMetrics;
  appointmentsTrend: StaffTrend;
  staffByRole: StaffDistributionItem[];
  staffByStatus: StaffDistributionItem[];
  topPerformingStaff: StaffPerformanceItem[];
  staffWorkload: StaffWorkloadItem[];
  insights: string[];
  /**
   * Features the schema has no data for. The frontend renders these as
   * unavailable rather than inventing numbers for them.
   */
  unavailableSections: string[];
}
