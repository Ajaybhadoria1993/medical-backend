export interface ReceptionAppointmentCounts {
  total: number;
  pending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  remaining: number;
}

export interface ReceptionPaymentSummary {
  collectedToday: number;
  paidCount: number;
  pendingAmount: number;
  pendingCount: number;
}

export interface ReceptionDoctorQueue {
  doctorId: string;
  doctorName: string;
  total: number;
  completed: number;
  remaining: number;
}

export interface ReceptionOverview {
  appointments: ReceptionAppointmentCounts;
  payments: ReceptionPaymentSummary;
  patientsRegisteredToday: number;
  doctorQueues: ReceptionDoctorQueue[];
}
