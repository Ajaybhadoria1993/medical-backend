export type RecentActivityType = 'appointment' | 'lab_test' | 'prescription';

export type RecentActivityTone =
  'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface RecentActivityChip {
  code: string;
  label: string;
  tone: RecentActivityTone;
}

export interface RecentActivityParty {
  id: string | null;
  name: string | null;
}

export interface RecentActivityPatient extends RecentActivityParty {
  relationship: string;
}

export interface RecentActivityItem {
  id: string;
  type: RecentActivityType;
  referenceId: string;
  appointmentId: string | null;
  title: string;
  subtitle: string;
  description: string | null;
  patient: RecentActivityPatient;
  doctor: RecentActivityParty | null;
  clinic: RecentActivityParty | null;
  occurredAt: string;
  displayDate: string;
  activityAt: string;
  status: RecentActivityChip;
  paymentStatus: RecentActivityChip | null;
  actionLabel: string;
  detailEndpoint: string | null;
}

export interface RecentActivityResponse {
  data: RecentActivityItem[];
  pagination: {
    totalRecords: number;
    totalPages: number;
    pageNumber: number;
    pageSize: number;
  };
  counts: Record<RecentActivityType, number>;
}
