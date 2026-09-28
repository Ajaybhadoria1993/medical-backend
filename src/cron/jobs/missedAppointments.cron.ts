// src/cron/jobs/missedAppointments.cron.ts
import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import logger from '../../utils/logger';
import { database } from '../../configurations/dbConnection';
import { istDayBoundsUtc } from '../../utils/istDateTime';
import { invalidateClinicDashboardCaches } from '../../main/dashboard/utils/dashboardCache.utils';

/** Marks the job's log rows, so the no-show policy can skip them as strikes. */
export const DAY_END_NO_SHOW_REASON =
  'Day ended without the visit being closed';

/**
 * Past-day appointments still open become 'NoShow' marked by 'system', and each
 * gets a No Show page log row. One statement: the UPDATE feeds the INSERT.
 * Its log reason keeps these out of policy strikes (see NoShowService.markAsNoShow).
 */
export async function markPastDayAppointmentsNoShow(): Promise<number> {
  // ISO string: raw SQL through postgres-js cannot bind a Date.
  const cutoff = istDayBoundsUtc().start.toISOString();
  const rows = await database.execute<{ clinic_id: string; n: number }>(sql`
    WITH target AS (
      SELECT id, appointment_status AS prev_status
      FROM appointments
      WHERE appointment_date < ${cutoff}
        AND appointment_status IN ('Pending', 'Confirmed', 'Upcoming', 'Patient Arrived')
      FOR UPDATE
    ), closed AS (
      UPDATE appointments a
      SET appointment_status = 'NoShow',
          no_show_marked_by = 'system',
          updated_at = NOW()
      FROM target t
      WHERE a.id = t.id
      RETURNING a.id, a.patient_id, a.doctor_id, a.clinic_id, a.appointment_date, t.prev_status
    ), history AS (
      -- Same entry the manual No Show button writes; performed_by NULL = system.
      INSERT INTO appointment_activity_history
        (appointment_id, action, performed_by, previous_state, new_state, remarks)
      SELECT id, 'STATUS_CHANGED', NULL,
             jsonb_build_object('appointmentStatus', prev_status),
             jsonb_build_object('appointmentStatus', 'NoShow', 'noShowMarkedBy', 'system'),
             'Marked as No Show by system: the day ended without the visit being closed'
      FROM closed
    ), logged AS (
      INSERT INTO appointment_no_show_actions
        (appointment_id, patient_id, doctor_id, clinic_id, marked_by_role, reason, action_taken, created_at)
      SELECT id, patient_id, doctor_id, clinic_id, 'system',
             ${DAY_END_NO_SHOW_REASON}, 'warning', appointment_date
      FROM closed
      RETURNING clinic_id
    )
    SELECT clinic_id, COUNT(*)::int AS n FROM logged GROUP BY clinic_id
  `);

  // Written outside the app's change path, so drop each touched clinic's dashboard cache.
  await Promise.all(
    rows.map((r) => invalidateClinicDashboardCaches(r.clinic_id))
  );
  return rows.reduce((sum, r) => sum + Number(r.n), 0);
}

/**
 * Schedule: daily at 00:05 IST, plus once at boot to catch a missed night.
 * The first run also closes all older data, so no separate backfill is needed.
 */
export function initMissedAppointments(): void {
  const run = async () => {
    try {
      const count = await markPastDayAppointmentsNoShow();
      logger.info(
        `[Cron:MissedAppointments] Marked ${count} as No Show (system)`
      );
    } catch (error) {
      logger.error('[Cron:MissedAppointments] Failed:', error);
    }
  };

  cron.schedule('5 0 * * *', run, { timezone: 'Asia/Kolkata' });
  void run();

  logger.info('[Cron:MissedAppointments] Scheduled at 00:05 AM IST daily');
}
