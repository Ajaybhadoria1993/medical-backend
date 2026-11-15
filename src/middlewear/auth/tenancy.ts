// Where the caller works: resolves req.clinicId / req.labId and the clinic idle timeout.
import { and, eq, isNull } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import { database } from '../../configurations/dbConnection';
import redisClient from '../../configurations/redisConfig';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../main/clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../main/clinic/models/clinicSettings.model';
import {
  LabsModel,
  UserLabAssignmentsModel,
} from '../../main/lab/models/lab.model';
import { PermissionService } from '../../main/permissions/services/permission.service';
import { findUserClinic } from '../../utils/userClinic';
import { CacheKeys } from '../../utils/cache.util';
import { asyncHandler, HttpError } from '../errorHandler';
import './types';

/** The user's clinic and its status, cached 5 minutes as "clinicId:status:Status"; null when none. */
export async function findUserClinicCached(user: {
  id: string;
  userType: string;
}): Promise<{ clinicId: string; status: string } | null> {
  const redisKey = `user_clinic:${user.id}`;
  const cached = await redisClient.get(redisKey);
  if (cached) {
    const [clinicId, status] = cached.split(':status:');
    return { clinicId, status };
  }

  const clinic = await findUserClinic(user.id, user.userType);
  if (!clinic) return null;
  await redisClient.setex(
    redisKey,
    300,
    `${clinic.clinicId}:status:${clinic.status}`
  );
  return { clinicId: clinic.clinicId, status: clinic.status };
}

export const requireClinic = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Authentication required');

    const clinic = await findUserClinicCached(user);
    if (!clinic?.clinicId) {
      throw new HttpError(403, 'Access denied');
    }
    const { clinicId, status: clinicStatus } = clinic;

    if (clinicStatus === 'Inactive') {
      throw new HttpError(
        403,
        'This clinic has been deactivated. Please contact support.'
      );
    }

    if (clinicStatus === 'Blocked') {
      throw new HttpError(
        403,
        'This clinic has been blocked. Please contact support.'
      );
    }

    if (clinicStatus === 'Rejected') {
      throw new HttpError(
        403,
        'This clinic registration was rejected. Please contact support.'
      );
    }

    // 'Pending' passes through on purpose: a clinic awaiting approval must still
    // be able to finish onboarding. Patient-facing discovery filters it out via
    // the `status = 'Active'` checks in PatientService.

    req.clinicId = clinicId;
    return next();
  }
);

export const requireLab = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Authentication required');

    let labId: string | undefined;
    let clinicId = req.clinicId;
    const isClinicLabAdmin =
      user.userType === 'Admin' ||
      user.userType === 'Super_Admin' ||
      user.userType === 'Receptionist';

    const redisKey = clinicId
      ? `user_lab:${user.id}:clinic:${clinicId}`
      : `user_lab:${user.id}`;
    const cachedLabId = await redisClient.get(redisKey);

    if (cachedLabId && cachedLabId !== 'undefined' && cachedLabId !== 'null') {
      labId = cachedLabId;
    } else {
      const conditions = [eq(UserLabAssignmentsModel.userId, user.id)];
      if (clinicId) {
        conditions.push(eq(UserLabAssignmentsModel.clinicId, clinicId));
      }

      const [row] = await database
        .select({
          labId: UserLabAssignmentsModel.labId,
          clinicId: UserLabAssignmentsModel.clinicId,
        })
        .from(UserLabAssignmentsModel)
        .where(and(...conditions))
        .limit(1);

      if (row) {
        labId = row.labId;
        clinicId = clinicId ?? row.clinicId;
        req.clinicId = clinicId;
      } else {
        if (!clinicId && isClinicLabAdmin) {
          const [clinicAssign] = await database
            .select({ clinicId: ClinicAssignModel.clinicId })
            .from(ClinicAssignModel)
            .where(eq(ClinicAssignModel.userId, user.id))
            .limit(1);

          clinicId = clinicAssign?.clinicId;
          req.clinicId = clinicId;
        }

        const hasLabTestPermission =
          clinicId &&
          (await PermissionService.hasResourcePermission(
            user.id,
            user.userType,
            clinicId,
            'lab_test'
          ));

        if (!clinicId || (!isClinicLabAdmin && !hasLabTestPermission)) {
          throw new HttpError(403, 'Lab access denied');
        }
        // Clinic admins and staff granted a lab_test:* permission may have no
        // user_lab_assignments row, so resolve the clinic's lab from clinic scope.
        const [lab] = await database
          .select({ labId: LabsModel.id })
          .from(LabsModel)
          .where(
            and(eq(LabsModel.clinicId, clinicId), isNull(LabsModel.deletedAt))
          )
          .limit(1);

        if (!lab) {
          throw new HttpError(403, 'Lab access denied');
        }

        labId = lab.labId;
      }

      // cache for 10 minutes
      await redisClient.setex(redisKey, 600, labId);
    }
    if (labId) {
      req.labId = labId;
      return next();
    } else {
      throw new HttpError(403, 'Access denied');
    }
  }
);

export const requireLabClinicContext = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (req.clinicId) {
      return next();
    }

    const labId = req.labId;
    if (!labId) {
      throw new HttpError(401, 'Lab context required.');
    }

    const [lab] = await database
      .select({ clinicId: LabsModel.clinicId })
      .from(LabsModel)
      .where(and(eq(LabsModel.id, labId), isNull(LabsModel.deletedAt)))
      .limit(1);

    if (!lab?.clinicId) {
      throw new HttpError(403, 'Lab access denied');
    }

    req.clinicId = lab.clinicId;
    return next();
  }
);

/**
 * Enforce clinic auto-logout based on inactivity.
 *
 * Applies only when:
 * - the current request has a resolved `req.clinicId` (via `requireClinic`)
 * - AND the authenticated user is the owner of that clinic (`clinics.user_id = auth user id`)
 * - AND there is a `clinic_settings` row for that clinic with `auto_logout_minutes` set.
 *
 * Behaviour:
 * - If last dashboard API activity is older than `auto_logout_minutes`, access is revoked (401).
 * - If the user continues calling APIs within that window, access is kept.
 */
export const enforceClinicAutoLogout = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Authentication required');

    const clinicId = req.clinicId;
    if (!clinicId) {
      // We only enforce auto-logout for clinic-scoped requests
      return next();
    }

    // 1️⃣ Load clinic + settings (cached in Redis for 30 minutes)
    const settingsCacheKey = CacheKeys.clinicAutoLogout(clinicId);
    let row: {
      clinicId: string;
      ownerId: string;
      autoLogoutMinutes: number | null;
    } | null = null;

    const activityKey = `session:last_activity:${clinicId}:${user.id}`;
    const [cached, lastActivityRaw] = await redisClient.mget(
      settingsCacheKey,
      activityKey
    );
    if (cached) {
      row = JSON.parse(cached);
    } else {
      const [dbRow] = await database
        .select({
          clinicId: ClinicModel.id,
          ownerId: ClinicModel.userId,
          autoLogoutMinutes: ClinicSettingsModel.autoLogoutMinutes,
        })
        .from(ClinicModel)
        .leftJoin(
          ClinicSettingsModel,
          eq(ClinicSettingsModel.clinicId, ClinicModel.id)
        )
        .where(eq(ClinicModel.id, clinicId))
        .limit(1);

      if (dbRow) {
        row = dbRow;
        // Cache for 30 minutes
        await redisClient.setex(settingsCacheKey, 1800, JSON.stringify(dbRow));
      }
    }

    if (!row) {
      // No such clinic -> let other guards handle it
      return next();
    }

    // 2️⃣ Enforce only when this user is the clinic owner AND settings exist
    if (row.ownerId !== user.id) {
      // Not the clinic owner -> no auto-logout enforcement
      return next();
    }

    const autoLogoutMinutes = row.autoLogoutMinutes;
    if (!autoLogoutMinutes || autoLogoutMinutes <= 0) {
      // No auto-logout configured -> allow
      return next();
    }

    // 3️⃣ Check last activity from Redis
    const now = Date.now();
    const redisKey = activityKey;

    if (lastActivityRaw) {
      const lastActivityTs = Number(lastActivityRaw);
      if (!Number.isNaN(lastActivityTs)) {
        const diffMinutes = (now - lastActivityTs) / (1000 * 60);
        if (diffMinutes >= autoLogoutMinutes) {
          // Idle beyond configured minutes -> revoke access
          await redisClient.del(redisKey);
          throw new HttpError(
            401,
            'Session expired due to inactivity. Please log in again.'
          );
        }
      }
    }

    // 4️⃣ Refresh last activity at most once a minute: logout can come up to 60s early,
    // in exchange for dropping a Redis write from nearly every request.
    const lastWrite = Number(lastActivityRaw);
    if (
      !lastActivityRaw ||
      Number.isNaN(lastWrite) ||
      now - lastWrite >= 60_000
    ) {
      const ttlSeconds = Math.max(
        autoLogoutMinutes * 60 * 2,
        autoLogoutMinutes * 60
      );
      await redisClient.setex(redisKey, ttlSeconds, String(now));
    }

    return next();
  }
);
