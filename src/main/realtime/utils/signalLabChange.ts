/**
 * Tells every screen watching one lab worklist — and, when the test is tied
 * to an appointment, the ordering doctor's encounter screen — that it changed.
 *
 * A lab order can exist without an appointment at all (an independent/walk-in
 * test — `appointmentId`/`doctorId` are `null` on `LabOrderModel` for those),
 * so the encounter half is opportunistic: signal it only when both ids are
 * present. See docs/REALTIME_ROLLOUT_PLAN.md Phase 3.
 *
 * Must be called post-commit, same rule as `signalAppointmentChange`.
 * Fire-and-forget: never throws, and never affects the caller's result.
 */

import logger from '../../../utils/logger';
import { realtimeBus } from '../services/realtimeBus.service';
import { target } from './sections';

export function signalLabChange(
  ctx: {
    clinicId: string;
    labId?: string | null;
    appointmentId?: string | null;
    doctorId?: string | null;
  },
  reason: string
): void {
  try {
    if (ctx.labId) {
      realtimeBus.notify(target.lab(ctx.labId), reason);
    }

    if (ctx.appointmentId && ctx.doctorId) {
      realtimeBus.notify(
        target.encounter(ctx.clinicId, ctx.doctorId, ctx.appointmentId),
        reason
      );
    }
  } catch (err) {
    logger.warn(
      `[Realtime] Failed to signal lab change for lab=${ctx.labId}`,
      err
    );
  }
}
