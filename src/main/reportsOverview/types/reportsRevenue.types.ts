export interface RevenueMetricItem {
  value: number;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral' | 'new';
}

export interface RevenueMetrics {
  totalRevenue: RevenueMetricItem;
  amountCollected: RevenueMetricItem;
  pendingAmount: RevenueMetricItem;
  avgInvoiceValue: RevenueMetricItem;
  totalInvoices: RevenueMetricItem;
  refunds: RevenueMetricItem;
}

export interface RevenueTrend {
  labels: string[];
  currentPeriod: number[];
  previousPeriod: number[];
}

export interface RevenueDistributionItem {
  label: string;
  value: number;
  percentage: number;
}

export interface DoctorRevenueItem {
  doctor: string;
  doctorId: string;
  revenue: number;
  percentage: number;
}

export interface ServiceRevenueItem {
  service: string;
  revenue: number;
  percentage: number;
}

export interface AppointmentTypeRevenueItem {
  appointmentType: string;
  revenue: number;
  percentage: number;
}

export interface OutstandingAgingItem {
  bracket: string;
  amount: number;
  percentage: number;
}

export interface MonthlyRevenueItem {
  month: string;
  thisYear: number;
  lastYear: number;
}

export interface YtdSummary {
  revenue: number;
  lastYearRevenue: number;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral' | 'new';
  collected: number;
  lastYearCollected: number;
  collectedChange: number;
  collectedChangeType: 'increase' | 'decrease' | 'neutral' | 'new';
  label: string;
}

export interface ReportsRevenueData {
  metrics: RevenueMetrics;
  revenueTrend: RevenueTrend;
  revenueBreakdown: RevenueDistributionItem[];
  paymentModeDistribution: RevenueDistributionItem[];
  topServices: ServiceRevenueItem[];
  doctorWiseRevenue: DoctorRevenueItem[];
  appointmentTypeRevenue: AppointmentTypeRevenueItem[];
  outstandingAging: OutstandingAgingItem[];
  monthlyRevenue: MonthlyRevenueItem[];
  ytd: YtdSummary;
  insights: string[];
}
