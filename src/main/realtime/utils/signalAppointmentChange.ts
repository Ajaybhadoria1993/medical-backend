/**
 * Tells every screen watching one appointment that it changed.
 *
 * Shared across every service that writes to an appointment or its related
 * tables (status, reschedule, clinical/vitals, payment) so each gets the same
 * signal fan-out instead of re-deriving it — see docs/REALTIME_ROLLOUT_PLAN.md.
 *
 * Four sections, because four different audiences render the same change:
 * the doctor's own queue, the clinic-wide reception board, the patient's view
 * of their own appointment, and the doctor's open encounter (clinical/vitals)
 * screen. Each carries no data — only a version — so the receiving screen
 * refetches whichever snapshot endpoint it already uses.
 *
 * Must be called post-commit. Calling it inside a transaction would let a
 * client refetch and read state that has not landed yet, or that is about to
 * roll back.
 *
 * Fire-and-forget: never throws, and never affects the caller's result.
 */

import logger from '../../../utils/logger';
import { getISTDateString } from '../../../utils/istDateTime';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { realtimeBus } from '../services/realtimeBus.service';
import { target } from './sections';

type ChangedAppointment = {
  id: string;
  clinicId: string;
  doctorId: string | null;
  patientId: string;
  appointmentDate: Date | string;
};

export function signalAppointmentChange(
  appt: ChangedAppointment,
  reason: string,
  /**
   * Set only when the appointment moved between days. The day it left is now
   * short one appointment, so that queue changed too and its watchers would
   * otherwise keep rendering a slot that is no longer there.
   */
  previousDate?: Date | string | null
): void {
  // Caches first: a screen refetches the moment the signal lands, and would
  // otherwise read the revenue and today-stats snapshots from before this change.
  void invalidateClinicDashboardCaches(appt.clinicId).finally(() =>
    notifyAppointmentChange(appt, reason, previousDate)
  );
}

function notifyAppointmentChange(
  appt: ChangedAppointment,
  reason: string,
  previousDate?: Date | string | null
): void {
  try {
    if (!appt.doctorId) return;

    const toDateString = (value: Date | string): string =>
      value instanceof Date
        ? getISTDateString(value)
        : String(value).split('T')[0];

    const date = toDateString(appt.appointmentDate);

    realtimeBus.notify(
      target.queue(appt.clinicId, appt.doctorId, date),
      reason
    );

    if (previousDate) {
      const oldDate = toDateString(previousDate);
      if (oldDate !== date) {
        realtimeBus.notify(
          target.queue(appt.clinicId, appt.doctorId, oldDate),
          reason
        );
      }
    }

    realtimeBus.notify(target.board(appt.clinicId), reason);
    realtimeBus.notify(target.appointment(appt.id, appt.patientId), reason);
    realtimeBus.notify(
      target.encounter(appt.clinicId, appt.doctorId, appt.id),
      reason
    );
    realtimeBus.notify(target.billing(appt.clinicId), reason);
  } catch (err) {
    logger.warn(
      `[Realtime] Failed to signal appointment change for appointment=${appt.id}`,
      err
    );
  }
}
