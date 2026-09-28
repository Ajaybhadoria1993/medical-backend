/**
 * Who is involved in an appointment event. Everything goes through DirectoryPort
 * so these rules survive the module being extracted (A5).
 */

import { envConfig } from '../../../../utils/envConfig';
import type { RecipientDeps } from '../types';

/** The wide set the legacy helpers notified, kept as the revert path. */
const CLINIC_STAFF_ROLES = ['Admin', 'Doctor', 'Receptionist'];

export interface AppointmentCtx extends Record<string, unknown> {
  appointmentId: string;
  clinicId: string;
  doctorId: string | null;
  patientId: string | null;
  /** Excluded from the result: nobody needs telling about their own action. */
  performerUserId?: string | null;
}

/**
 * The treating doctor plus, per NOTIFY_STRICT_RECIPIENTS_APPOINTMENT, either the
 * staff responsible for them or the legacy clinic-wide set. Two flags so routing
 * through the registry and narrowing recipients stay separately revertible.
 */
export async function appointmentStaff(
  ctx: AppointmentCtx,
  { directory }: RecipientDeps
): Promise<string[]> {
  const staff = envConfig.NOTIFY_STRICT_RECIPIENTS_APPOINTMENT
    ? await directory.getStaffResponsibleForDoctor(ctx.clinicId, ctx.doctorId)
    : await directory.getStaffByRole(ctx.clinicId, CLINIC_STAFF_ROLES);

  const scopedStaff = staff.filter(
    (s) => s.userType !== 'Admin' || s.id === ctx.doctorId
  );

  const ids = [ctx.doctorId, ...scopedStaff.map((s) => s.id)].filter(
    (id): id is string => Boolean(id)
  );

  // Deduplicated: on the wide path the treating doctor is in the role list too.
  return [...new Set(ids)].filter((id) => id !== ctx.performerUserId);
}

/**
 * Same as {@link appointmentStaff}, minus reception.
 *
 * Reception books and confirms appointments themselves, so a row per status
 * change is noise about their own action, and it buries the events they do have
 * to act on (a new booking, a cancellation). The treating doctor is unaffected,
 * and the Admin scoping in appointmentStaff carries through unchanged.
 */
export async function appointmentStaffExcludingReception(
  ctx: AppointmentCtx,
  deps: RecipientDeps
): Promise<string[]> {
  const ids = await appointmentStaff(ctx, deps);
  const reception = new Set(
    (await deps.directory.getStaffByRole(ctx.clinicId, ['Receptionist'])).map(
      (s) => s.id
    )
  );
  // The treating doctor stays, in the rare case they also hold the role.
  return ids.filter((id) => id === ctx.doctorId || !reception.has(id));
}

/**
 * The patient, unless they acted. A separate audience because they read
 * different copy and hold no clinic permission to filter on.
 */
export function appointmentPatient(ctx: AppointmentCtx): string[] {
  if (!ctx.patientId || ctx.patientId === ctx.performerUserId) return [];
  return [ctx.patientId];
}
