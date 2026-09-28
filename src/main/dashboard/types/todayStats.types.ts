export interface TodayAppointmentStats {
  total: number;
  left: number;
}

export interface QueueWaitingStats {
  total: number;
  patientArrived: number;
}

export interface ActiveDoctorsStats {
  activeNow: number;
  totalAvailableToday: number;
}

export interface PendingPaymentStats {
  pending: number;
  total: number;
}

export interface ClinicDayProgress {
  clinicStartTime: string | null; // 'hh:mm AM/PM', null if nobody scheduled today
  clinicEndTime: string | null; // 'hh:mm AM/PM', null if nobody scheduled today
  currentTime: string; // 'HH:mm' (24h) IST
  percentage: number;
  timeLeft: string; // 'HH:mm' remaining until clinicEndTime, or '-' before clinicStartTime
}

export interface ReceptionTodayStats {
  todayAppointments: TodayAppointmentStats;
  queueWaiting: QueueWaitingStats;
  activeDoctors: ActiveDoctorsStats;
  pendingPayment: PendingPaymentStats;
  dayProgress: ClinicDayProgress;
}
