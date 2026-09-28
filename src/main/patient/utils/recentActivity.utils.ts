import { IST_TIMEZONE } from '../../../utils/istDateTime';
import type {
  RecentActivityChip,
  RecentActivityTone,
} from '../types/recentActivity.types';

const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** Card date line rendered exactly as the patient app shows it: "Wed, 05 Aug 05:25 PM". */
export function formatActivityDisplayDate(instant: Date): string {
  const parts = DISPLAY_DATE_FORMATTER.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${part('weekday')}, ${part('day')} ${part('month')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}

const APPOINTMENT_STATUS_CHIPS: Record<
  string,
  { label: string; tone: RecentActivityTone }
> = {
  Upcoming: { label: 'Upcoming', tone: 'info' },
  Confirmed: { label: 'Confirmed', tone: 'success' },
  Completed: { label: 'Completed', tone: 'success' },
  Cancelled: { label: 'Cancelled', tone: 'danger' },
  Rescheduled: { label: 'Rescheduled', tone: 'info' },
  Pending: { label: 'Pending', tone: 'warning' },
  Missed: { label: 'Missed', tone: 'danger' },
  'Patient Arrived': { label: 'Patient Arrived', tone: 'info' },
  NoShow: { label: 'No Show', tone: 'danger' },
};

const PAYMENT_STATUS_CHIPS: Record<
  string,
  { label: string; tone: RecentActivityTone }
> = {
  paid: { label: 'Paid', tone: 'success' },
  'already paid': { label: 'Paid', tone: 'success' },
  pending: { label: 'Payment Pending', tone: 'warning' },
  failed: { label: 'Payment Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'info' },
  'free consultation': { label: 'Free', tone: 'neutral' },
};

const LAB_REPORT_STATUS_CHIPS: Record<
  string,
  { label: string; tone: RecentActivityTone }
> = {
  Initiated: { label: 'Initiated', tone: 'info' },
  InProgress: { label: 'In Progress', tone: 'warning' },
  Completed: { label: 'Report Ready', tone: 'success' },
};

function toChip(
  code: string | null | undefined,
  map: Record<string, { label: string; tone: RecentActivityTone }>,
  fallbackTone: RecentActivityTone = 'neutral'
): RecentActivityChip | null {
  if (!code) return null;
  const entry = map[code] ?? map[code.toLowerCase()];
  return {
    code,
    label: entry?.label ?? code,
    tone: entry?.tone ?? fallbackTone,
  };
}

export function buildAppointmentStatusChip(
  status: string | null | undefined
): RecentActivityChip {
  return (
    toChip(status, APPOINTMENT_STATUS_CHIPS, 'info') ?? {
      code: 'Unknown',
      label: 'Unknown',
      tone: 'neutral',
    }
  );
}

export function buildPaymentStatusChip(
  status: string | null | undefined
): RecentActivityChip | null {
  return toChip(status, PAYMENT_STATUS_CHIPS, 'neutral');
}

export function buildLabReportStatusChip(
  status: string | null | undefined
): RecentActivityChip {
  return (
    toChip(status, LAB_REPORT_STATUS_CHIPS, 'info') ?? {
      code: 'Initiated',
      label: 'Initiated',
      tone: 'info',
    }
  );
}

/**
 * The card renders a single chip, so a failed/pending payment has to win over the
 * workflow status — that is what makes the screenshot show "Payment Failed" on a
 * lab test whose report status is still "Initiated".
 */
export function resolvePrimaryChip(
  statusChip: RecentActivityChip,
  paymentChip: RecentActivityChip | null
): RecentActivityChip {
  if (
    paymentChip &&
    (paymentChip.tone === 'danger' || paymentChip.tone === 'warning')
  ) {
    return paymentChip;
  }
  return statusChip;
}

export function activityDisplayName(name: string | null | undefined): string {
  return name?.trim() || 'Patient';
}
