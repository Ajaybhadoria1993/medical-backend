import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import { getSourceDataPort } from '../ports';
import type {
  AuditQueryDto,
  SessionsQueryDto,
} from '../schemas/superadminAnalytics.schema';
import type {
  AuditListResponse,
  SessionListResponse,
} from '../types/responses.types';
import { describeDevice } from '../utils/device.utils';
import { resolvePeriod } from '../utils/period.utils';

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Who did what (audit log) and who is signed in (sessions) across clinics. Never cached: support looks here live. */
export class AccessService {
  static async audit(q: AuditQueryDto): Promise<AuditListResponse> {
    const p = resolvePeriod({ from: q.from, to: q.to });
    const { items, total, types } = await getSourceDataPort().listAudit(
      {
        clinicId: q.clinicId,
        type: q.type,
        role: q.role,
        from: p.current.from,
        to: p.current.to,
      },
      q.pageSize,
      (q.pageNumber - 1) * q.pageSize
    );
    return {
      period: p.current,
      items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total,
      pageNumber: q.pageNumber,
      pageSize: q.pageSize,
      types,
    };
  }

  /** Signs one staff member out of every device now; logged with who did it. */
  static async signOut(userId: string, actorId: string) {
    const user = await getSourceDataPort().signOutEverywhere(userId);
    if (!user) throw new HttpError(404, 'No clinic staff account with that id');
    logger.info(
      `[SuperAdmin] ${actorId} signed out ${userId} (${user.role}) from all devices`
    );
    return user;
  }

  static async sessions(q: SessionsQueryDto): Promise<SessionListResponse> {
    const { items, total } = await getSourceDataPort().listSessions(
      { q: q.q, platform: q.platform, activeOnly: q.activeOnly },
      q.pageSize,
      (q.pageNumber - 1) * q.pageSize
    );
    const now = Date.now();
    return {
      items: items.map(({ userAgent, ...r }) => ({
        ...r,
        device: describeDevice(r.platform, userAgent),
        // created_at is a DB default (IST clock); expires_at is app-written UTC. Normalise to real instants.
        signedInAt: new Date(
          r.signedInAt.getTime() - IST_OFFSET_MS
        ).toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        active: r.expiresAt.getTime() > now,
      })),
      total,
      pageNumber: q.pageNumber,
      pageSize: q.pageSize,
    };
  }
}
