// src/utils/clinicOwnership.ts
// Redis-cached tenancy checks — used by any GET/PUT/POST/DELETE route that
// accepts a secondary resource id (doctorId, appointmentId, ...) via
// query/params and must verify it belongs to the caller's own clinic
// (req.clinicId) before touching data. Mirrors the caching pattern already
// used by requireClinic's `user_clinic:{userId}` cache in auth.middleware.ts,
// so these checks cost a Redis read instead of a Postgres query on repeat calls.
import { and, eq } from 'drizzle-orm';
import { database } from '../configurations/dbConnection';
import redisClient from '../configurations/redisConfig';
import { ClinicAssignModel } from '../main/clinic/models/clinic.model';
import { AppointmentModel } from '../main/appointments/models/appointment.model';

// Staff-clinic assignments change rarely (an admin action), but can change —
// same 5min TTL as requireClinic's own cache, no invalidation hook needed
// since a stale cache self-corrects within 5 minutes either way.
const DOCTOR_ASSIGN_TTL_SECONDS = 300;

// An appointment's clinicId is immutable once created — appointments are
// never moved between clinics — so this mapping never goes stale and can be
// cached for a long time with no invalidation logic at all.
const APPOINTMENT_CLINIC_TTL_SECONDS = 21600; // 6 hours

/**
 * Returns true if `doctorId` is currently assigned to `clinicId`.
 * Redis-cached for DOCTOR_ASSIGN_TTL_SECONDS.
 */
export async function isDoctorAssignedToClinic(
  doctorId: string,
  clinicId: string
): Promise<boolean> {
  const cacheKey = `clinic_doctor_assign:${clinicId}:${doctorId}`;
  const cached = await redisClient.get(cacheKey);
  if (cached !== null) {
    return cached === '1';
  }

  const [row] = await database
    .select({ id: ClinicAssignModel.id })
    .from(ClinicAssignModel)
    .where(
      and(
        eq(ClinicAssignModel.userId, doctorId),
        eq(ClinicAssignModel.clinicId, clinicId)
      )
    )
    .limit(1);

  const isAssigned = Boolean(row);
  await redisClient.setex(
    cacheKey,
    DOCTOR_ASSIGN_TTL_SECONDS,
    isAssigned ? '1' : '0'
  );
  return isAssigned;
}

/**
 * Returns true if `appointmentId` belongs to `clinicId`.
 * Redis-cached for APPOINTMENT_CLINIC_TTL_SECONDS (this mapping is immutable).
 */
export async function isAppointmentInClinic(
  appointmentId: string,
  clinicId: string
): Promise<boolean> {
  const cacheKey = `appointment_clinic:${appointmentId}`;
  const cached = await redisClient.get(cacheKey);
  if (cached !== null) {
    return cached === clinicId;
  }

  const [row] = await database
    .select({ clinicId: AppointmentModel.clinicId })
    .from(AppointmentModel)
    .where(eq(AppointmentModel.id, appointmentId))
    .limit(1);

  if (!row) {
    // Don't cache "not found" — a not-yet-created appointmentId could be
    // created moments later, and this path is cheap/rare enough not to matter.
    return false;
  }

  await redisClient.setex(
    cacheKey,
    APPOINTMENT_CLINIC_TTL_SECONDS,
    row.clinicId
  );
  return row.clinicId === clinicId;
}
