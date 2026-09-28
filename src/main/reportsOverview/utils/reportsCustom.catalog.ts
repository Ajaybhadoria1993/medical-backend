import {
  CustomCatalogDataSource,
  CustomValueType,
} from '../types/reportsCustom.types';

/**
 * Everything the custom report engine is allowed to put into SQL lives here.
 *
 * The client never sends SQL, column names or table names — it sends catalogue
 * ids, and only ids present in these maps are resolved to the developer-authored
 * fragments below. Anything else is rejected by the Zod layer before it reaches
 * the query builder. Values (dates, uuids, statuses) are always bound as
 * parameters, never interpolated.
 */

export const CUSTOM_BASE_FROM = `
  FROM appointments a
  LEFT JOIN appointment_payments p ON p.appointment_id = a.id
  LEFT JOIN users doc ON doc.id = a.doctor_id
  LEFT JOIN users pat ON pat.id = a.patient_id
  LEFT JOIN clinics_service cs ON cs.id = a.clinic_service_id
`;

const PRICE = `CAST(COALESCE(p.price, '0') AS NUMERIC)`;
const REFUNDED = `CAST(NULLIF(COALESCE(p.refunded_amount, '0'), '') AS NUMERIC)`;
const COLLECTED = `LOWER(p.payment_status) IN ('paid', 'already paid')`;
const PENDING = `LOWER(p.payment_status) IN ('pending', 'credit')`;
const BILLED = `LOWER(COALESCE(p.payment_status, '')) NOT IN ('refunded', 'failed')`;

export interface MetricDefinition {
  id: string;
  label: string;
  category: string;
  type: CustomValueType;
  /** Aggregate expression over the base FROM. */
  expression: string;
}

export const CUSTOM_METRICS: Record<string, MetricDefinition> = {
  totalAppointments: {
    id: 'totalAppointments',
    label: 'Total Appointments',
    category: 'Appointments',
    type: 'number',
    expression: `COUNT(a.id)`,
  },
  completedAppointments: {
    id: 'completedAppointments',
    label: 'Completed',
    category: 'Appointments',
    type: 'number',
    expression: `COUNT(a.id) FILTER (WHERE a.appointment_status = 'Completed')`,
  },
  cancelledAppointments: {
    id: 'cancelledAppointments',
    label: 'Cancelled',
    category: 'Appointments',
    type: 'number',
    expression: `COUNT(a.id) FILTER (WHERE a.appointment_status = 'Cancelled')`,
  },
  noShowAppointments: {
    id: 'noShowAppointments',
    label: 'No Show',
    category: 'Appointments',
    type: 'number',
    expression: `COUNT(a.id) FILTER (WHERE a.appointment_status = 'NoShow')`,
  },
  rescheduledAppointments: {
    id: 'rescheduledAppointments',
    label: 'Rescheduled',
    category: 'Appointments',
    type: 'number',
    expression: `COUNT(a.id) FILTER (WHERE a.appointment_status = 'Rescheduled')`,
  },
  completionRate: {
    id: 'completionRate',
    label: 'Completion %',
    category: 'Appointments',
    type: 'percentage',
    expression: `ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.appointment_status = 'Completed') / NULLIF(COUNT(a.id), 0), 1)`,
  },
  cancellationRate: {
    id: 'cancellationRate',
    label: 'Cancellation %',
    category: 'Appointments',
    type: 'percentage',
    expression: `ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.appointment_status = 'Cancelled') / NULLIF(COUNT(a.id), 0), 1)`,
  },
  uniquePatients: {
    id: 'uniquePatients',
    label: 'Unique Patients',
    category: 'Patients',
    type: 'number',
    expression: `COUNT(DISTINCT a.patient_id)`,
  },
  totalRevenue: {
    id: 'totalRevenue',
    label: 'Total Revenue',
    category: 'Revenue',
    type: 'currency',
    expression: `ROUND(COALESCE(SUM(${PRICE}) FILTER (WHERE ${BILLED}), 0))`,
  },
  amountCollected: {
    id: 'amountCollected',
    label: 'Amount Collected',
    category: 'Revenue',
    type: 'currency',
    expression: `ROUND(COALESCE(SUM(${PRICE}) FILTER (WHERE ${COLLECTED}), 0))`,
  },
  pendingAmount: {
    id: 'pendingAmount',
    label: 'Pending Amount',
    category: 'Revenue',
    type: 'currency',
    expression: `ROUND(COALESCE(SUM(${PRICE}) FILTER (WHERE ${PENDING}), 0))`,
  },
  refunds: {
    id: 'refunds',
    label: 'Refunds',
    category: 'Revenue',
    type: 'currency',
    expression: `ROUND(COALESCE(SUM(${REFUNDED}), 0))`,
  },
  avgConsultationFee: {
    id: 'avgConsultationFee',
    label: 'Avg. Consultation Fee',
    category: 'Revenue',
    type: 'currency',
    expression: `ROUND(COALESCE(AVG(${PRICE}) FILTER (WHERE ${BILLED} AND ${PRICE} > 0), 0))`,
  },
};

export interface DimensionDefinition {
  id: string;
  label: string;
  /** Expression used for both SELECT and GROUP BY. */
  expression: string;
  /** Expression the result is ordered by when this dimension is the sort key. */
  sortExpression?: string;
}

export const CUSTOM_DIMENSIONS: Record<string, DimensionDefinition> = {
  doctor: {
    id: 'doctor',
    label: 'Doctor',
    expression: `COALESCE(doc.name, 'Unassigned')`,
  },
  patient: {
    id: 'patient',
    label: 'Patient',
    expression: `COALESCE(pat.name, 'Unknown')`,
  },
  service: {
    id: 'service',
    label: 'Service',
    expression: `COALESCE(cs.service_name, 'Unassigned')`,
  },
  appointmentType: {
    id: 'appointmentType',
    label: 'Appointment Type',
    expression: `COALESCE(a.appointment_type, 'Other')`,
  },
  appointmentStatus: {
    id: 'appointmentStatus',
    label: 'Status',
    expression: `a.appointment_status::text`,
  },
  paymentMode: {
    id: 'paymentMode',
    label: 'Payment Mode',
    expression: `COALESCE(p.payment_mode, 'Not recorded')`,
  },
  day: {
    id: 'day',
    label: 'Day',
    expression: `to_char(date_trunc('day', a.appointment_date), 'DD Mon YYYY')`,
    sortExpression: `MIN(date_trunc('day', a.appointment_date))`,
  },
  month: {
    id: 'month',
    label: 'Month',
    expression: `to_char(date_trunc('month', a.appointment_date), 'Mon YYYY')`,
    sortExpression: `MIN(date_trunc('month', a.appointment_date))`,
  },
};

/**
 * Filters the client may set. Each maps to a parameterised predicate built in
 * the service — the ids here only decide which predicates are legal.
 */
export const CUSTOM_FILTER_IDS = [
  'doctorId',
  'patientId',
  'service',
  'appointmentType',
  'appointmentStatus',
  'paymentStatus',
  'paymentMode',
] as const;

export type CustomFilterId = (typeof CUSTOM_FILTER_IDS)[number];

const APPOINTMENT_STATUSES = [
  'Upcoming',
  'Completed',
  'Cancelled',
  'Rescheduled',
  'Pending',
  'Missed',
  'Confirmed',
  'Patient Arrived',
  'NoShow',
];

const PAYMENT_STATUS_BUCKETS = [
  { label: 'Collected', value: 'collected' },
  { label: 'Pending', value: 'pending' },
  { label: 'Refunded', value: 'refunded' },
];

/**
 * Data sources are presentational groupings over the same appointment fact
 * table — they decide which metrics and dimensions the builder offers, not a
 * different query shape.
 */
const metricsFor = (categories: string[]) =>
  Object.values(CUSTOM_METRICS)
    .filter((m) => categories.includes(m.category))
    .map(({ id, label, category, type }) => ({ id, label, category, type }));

const dimensionsFor = (ids: string[]) =>
  ids.map((id) => ({
    id,
    label: CUSTOM_DIMENSIONS[id].label,
  }));

const SHARED_FILTERS = [
  {
    id: 'appointmentStatus',
    label: 'Appointment Status',
    type: 'multiselect' as const,
    options: APPOINTMENT_STATUSES.map((s) => ({ label: s, value: s })),
  },
  {
    id: 'paymentStatus',
    label: 'Payment Status',
    type: 'select' as const,
    options: PAYMENT_STATUS_BUCKETS,
  },
  { id: 'doctorId', label: 'Doctor', type: 'lookup' as const },
  { id: 'service', label: 'Service', type: 'lookup' as const },
];

export const CUSTOM_DATA_SOURCES: CustomCatalogDataSource[] = [
  {
    id: 'appointments',
    label: 'Appointments',
    metrics: metricsFor(['Appointments', 'Patients']),
    dimensions: dimensionsFor([
      'doctor',
      'service',
      'appointmentType',
      'appointmentStatus',
      'patient',
      'day',
      'month',
    ]),
    filters: SHARED_FILTERS,
  },
  {
    id: 'revenue',
    label: 'Revenue',
    metrics: metricsFor(['Revenue', 'Appointments']),
    dimensions: dimensionsFor([
      'doctor',
      'service',
      'paymentMode',
      'appointmentType',
      'day',
      'month',
    ]),
    filters: SHARED_FILTERS,
  },
  {
    id: 'patients',
    label: 'Patients',
    metrics: metricsFor(['Patients', 'Appointments']),
    dimensions: dimensionsFor([
      'patient',
      'doctor',
      'service',
      'appointmentType',
      'month',
    ]),
    filters: SHARED_FILTERS,
  },
];

export const CUSTOM_DATA_SOURCE_IDS = CUSTOM_DATA_SOURCES.map((s) => s.id);
