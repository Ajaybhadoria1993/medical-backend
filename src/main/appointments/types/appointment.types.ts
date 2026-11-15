/** One row of Payment History: a payment, refund or due, from an appointment or a plan. */
export interface PaymentTransaction {
  /** Stable local row ID for this payment/refund transaction. */
  id: string;
  paymentRecordId?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  providerRefundId?: string | null;
  /** Stable local reference for offline/manual transactions. */
  localReference?: string | null;
  patientName: string;
  patientMobile: string;
  doctorName: string;
  doctorSpeciality: string;
  serviceName: string;
  appointmentDate: Date;
  transactionTimestamp: Date;
  price: number;
  entryType: 'Credit' | 'Debit';
  /** Per row, so the screen tells money collected ('Paid') from dues ('Pending') and refunds. */
  paymentStatus: 'Paid' | 'Pending' | 'Failed' | 'Already Paid' | 'Refunded';
  paymentMode?: string;
  refundMode?: string;
  refundNotes?: string;
  channel?: 'online' | 'offline';
  transactionId: string;
  originalAppointmentId: string;
  gatewayTransactionId?: string;
  bookingSource?: string;
  /** Absent = appointment. */
  source?: 'appointment' | 'treatment_plan';
  planId?: string;
  receiptNo?: string;
}

export type ClinicAppointmentDetailsMetricKey =
  | 'totalAppointments'
  | 'completed'
  | 'upcoming'
  | 'cancelled'
  | 'noShow'
  | 'confirmed'
  | 'patientArrived';

export type ClinicAppointmentDetailsCounts = Record<
  ClinicAppointmentDetailsMetricKey,
  number
>;
