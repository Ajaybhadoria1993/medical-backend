import {
  appointmentInstantIST,
  IST_TIMEZONE,
} from '../../../../utils/istDateTime';
import type { AppointmentContext } from '../../ports';
import { formatAppointmentTime } from '../../utils/whatsappTemplate.utils';

/**
 * "Fri, 12 Sep at 4:30 PM", or "Fri, 12 Sep · token 14" for a token clinic.
 *
 * Returns undefined rather than a partial string when the schedule is missing,
 * so the copy falls back to its own wording instead of printing "at undefined".
 */
export function formatSchedule(info: AppointmentContext): string | undefined {
  if (!info.appointmentDate) return undefined;

  // Validated before appointmentInstantIST, not after: that helper calls
  // toISOString() on the value and throws RangeError on a malformed one, so a
  // check on its result never runs.
  const parsed =
    info.appointmentDate instanceof Date
      ? info.appointmentDate
      : new Date(info.appointmentDate);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const instant = appointmentInstantIST(
    parsed,
    info.appointmentTime ?? '00:00'
  );
  if (Number.isNaN(instant.getTime())) return undefined;

  // Formatted here rather than reusing the WhatsApp formatter: that one carries
  // the year for a Meta template read out of context, which is noise in a bell
  // notification about something happening this week.
  const date = instant.toLocaleDateString('en-GB', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  // A token clinic has no meaningful time — the patient is seen in order, so
  // printing a slot time would be a promise the queue does not make.
  if (info.tokenNo) return `${date} · token ${info.tokenNo}`;
  if (!info.appointmentTime) return date;

  return `${date} at ${formatAppointmentTime(instant)}`;
}
