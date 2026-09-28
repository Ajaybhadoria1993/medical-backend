export interface CancellationReason {
  code: string;
  displayName: string;
  description: string;
  isActive: boolean;
}

export const CANCELLATION_REASONS: CancellationReason[] = [
  {
    code: 'patient_requested',
    displayName: 'Patient Requested',
    description: 'Patient requested cancellation',
    isActive: true,
  },
  {
    code: 'doctor_unavailable',
    displayName: 'Doctor Unavailable',
    description: 'Doctor is not available at this slot',
    isActive: true,
  },
  {
    code: 'clinic_closed',
    displayName: 'Clinic Closed',
    description: 'Clinic is closed for holiday or emergency',
    isActive: true,
  },
  {
    code: 'medical_emergency',
    displayName: 'Medical Emergency',
    description: 'Medical emergency situation',
    isActive: true,
  },
  {
    code: 'duplicate_booking',
    displayName: 'Duplicate Booking',
    description: 'Duplicate appointment booked accidentally',
    isActive: true,
  },
  {
    code: 'payment_failure',
    displayName: 'Payment Failure',
    description: 'Payment processing issue or failure',
    isActive: true,
  },
  {
    code: 'scheduling_conflict',
    displayName: 'Scheduling Conflict',
    description: 'Conflict with another schedule',
    isActive: true,
  },
  {
    code: 'administrative_error',
    displayName: 'Administrative Error',
    description: 'Staff booked incorrect slot or details',
    isActive: true,
  },
  {
    code: 'insurance_issue',
    displayName: 'Insurance Issue',
    description: 'Insurance authorization issue',
    isActive: true,
  },
  {
    code: 'doctor_leave',
    displayName: 'Doctor Leave',
    description: 'Doctor is on planned leave',
    isActive: true,
  },
  {
    code: 'other',
    displayName: 'Other',
    description: 'Any other unspecified reason',
    isActive: true,
  },
];
