import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { CacheKeys } from '../../../utils/cache.util';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';
import { getOffsetPagination } from '../../../utils/queryHelpers';
import { maskEmail } from '../../../utils/sensitiveMask.utils';
import {
  SupportSessionsModel,
  SupportSessionViewsModel,
} from '../models/supportSession.model';
import { getAccountPort } from '../ports';
import type {
  StartedSupportSession,
  StartSupportSessionInput,
  SupportSessionPage,
} from '../types/supportAccess.types';
import { SESSION_MINUTES, VIEWABLE_ROLES } from '../utils/supportAccess.utils';

const SESSION_SECONDS = SESSION_MINUTES * 60;

export class SupportSessionService {
  /** Ends the Super Admin's open session and opens a new one. */
  static async start(
    input: StartSupportSessionInput
  ): Promise<StartedSupportSession> {
    const account = getAccountPort();

    const target = await account.getUser(input.targetUserId);
    const targetClinicId = target
      ? await account.getUserClinicId(target.id, target.userType)
      : null;
    if (!target || targetClinicId !== input.clinicId) {
      throw new HttpError(404, 'Staff member not found in this clinic');
    }
    if (!VIEWABLE_ROLES.includes(target.userType)) {
      throw new HttpError(422, 'You can only view as clinic staff.');
    }
    if (target.userStatus !== 'Active') {
      throw new HttpError(
        409,
        'This staff member is not active, so their view cannot be opened.'
      );
    }

    await this.endOpen(input.superAdminId, 'replaced');

    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    const [session] = await database
      .insert(SupportSessionsModel)
      .values({
        superAdminId: input.superAdminId,
        targetUserId: target.id,
        clinicId: input.clinicId,
        targetRole: target.userType,
        reason: input.reason,
        expiresAt,
      })
      .returning({ id: SupportSessionsModel.id });

    await redisClient.setex(
      CacheKeys.supportSession(session.id),
      SESSION_SECONDS,
      input.superAdminId
    );

    const token = jwt.sign(
      { sub: target.id, sup: session.id, act: input.superAdminId },
      envConfig.JWT_SECRET_KEY,
      { expiresIn: SESSION_SECONDS }
    );

    const actorNames = await account.getUserNames([input.superAdminId]);
    return {
      sessionId: session.id,
      token,
      expiresAt,
      actorName: actorNames.get(input.superAdminId) ?? 'Super Admin',
      user: { ...target, email: target.email ? maskEmail(target.email) : null },
    };
  }

  /** Ends one session from its own "View as" tab. Safe to repeat. */
  static async end(sessionId: string): Promise<void> {
    await database
      .update(SupportSessionsModel)
      .set({ endedAt: new Date(), endReason: 'exit' })
      .where(
        and(
          eq(SupportSessionsModel.id, sessionId),
          isNull(SupportSessionsModel.endedAt)
        )
      );
    await this.dropLiveMarkers([sessionId]);
  }

  /** Ends every open session of this Super Admin; returns how many. */
  static async endAll(superAdminId: string): Promise<{ ended: number }> {
    const ended = await this.endOpen(superAdminId, 'end_all');
    return { ended };
  }

  static async listForClinic(
    clinicId: string,
    query: { pageNumber?: number; pageSize?: number }
  ): Promise<SupportSessionPage> {
    const { limit, offset, pageNumber, pageSize } = getOffsetPagination(
      query,
      50
    );
    const where = eq(SupportSessionsModel.clinicId, clinicId);
    const [rows, [{ total }]] = await Promise.all([
      database
        .select()
        .from(SupportSessionsModel)
        .where(where)
        .orderBy(desc(SupportSessionsModel.startedAt))
        .limit(limit)
        .offset(offset),
      database
        .select({ total: count() })
        .from(SupportSessionsModel)
        .where(where),
    ]);

    const ids = rows.map((r) => r.id);
    const [views, names] = await Promise.all([
      ids.length
        ? database
            .select({
              sessionId: SupportSessionViewsModel.sessionId,
              views: count(),
            })
            .from(SupportSessionViewsModel)
            .where(inArray(SupportSessionViewsModel.sessionId, ids))
            .groupBy(SupportSessionViewsModel.sessionId)
        : [],
      getAccountPort().getUserNames([
        ...new Set(rows.flatMap((r) => [r.superAdminId, r.targetUserId])),
      ]),
    ]);
    const viewsOf = new Map(views.map((v) => [v.sessionId, v.views]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        superAdminName: names.get(r.superAdminId) ?? 'Unknown user',
        targetName: names.get(r.targetUserId) ?? 'Unknown user',
        targetRole: r.targetRole,
        reason: r.reason,
        startedAt: r.startedAt,
        expiresAt: r.expiresAt,
        endedAt: r.endedAt,
        endReason: r.endReason,
        pagesViewed: viewsOf.get(r.id) ?? 0,
      })),
      pageNumber,
      pageSize,
      total,
    };
  }

  /** Logs one screen opened during a session. Never throws: a log miss must not break the view. */
  static async recordView(sessionId: string, path: string): Promise<void> {
    try {
      await database
        .insert(SupportSessionViewsModel)
        .values({ sessionId, path: path.slice(0, 255) });
    } catch (error) {
      logger.warn('[SupportAccess] Failed to log a viewed page', error);
    }
  }

  private static async endOpen(
    superAdminId: string,
    endReason: 'replaced' | 'end_all'
  ): Promise<number> {
    const ended = await database
      .update(SupportSessionsModel)
      .set({ endedAt: new Date(), endReason })
      .where(
        and(
          eq(SupportSessionsModel.superAdminId, superAdminId),
          isNull(SupportSessionsModel.endedAt),
          gt(SupportSessionsModel.expiresAt, new Date())
        )
      )
      .returning({ id: SupportSessionsModel.id });
    await this.dropLiveMarkers(ended.map((s) => s.id));
    return ended.length;
  }

  /** The live marker is what requireAuth checks, so deleting it ends the session at once. */
  private static async dropLiveMarkers(sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    await redisClient.del(...sessionIds.map(CacheKeys.supportSession));
  }
}
