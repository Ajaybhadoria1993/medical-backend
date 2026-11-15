export type RevenueBreakdownView = 'daily' | 'doctor' | 'service';

export interface ClinicFinanceDateRange {
  startDate: string;
  endDate: string;
}

export interface FinanceAmountRow {
  booked: string | number | null;
  completed: string | number | null;
  cancelled: string | number | null;
}

export interface CancellationSettingsContract {
  userCancellationRights: {
    patientsCanCancelOnline: boolean;
    doctorsCanCancel: boolean;
    receptionistsCanCancel: boolean;
    adminCanCancel: boolean;
  };
  cancellationWindows: {
    onlineConsultationHours: number;
    offlineInClinicHours: number;
  };
  patientCancellationLimits: {
    cooldownMinutes: number;
    maxPerDay: number;
    maxPerWeek: number;
    maxPerMonth: number;
  };
  cancellationReasonAndComments: {
    reasonRequired: boolean;
    commentsAllowed: boolean;
    minCommentLength: number;
    maxCommentLength: number;
  };
  reschedulingRules: {
    maxReschedulesPerAppointment: number;
    rescheduleAllowedUntilHours: number;
    paymentCarriedForward: boolean;
  };
}
