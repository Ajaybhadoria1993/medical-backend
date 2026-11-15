import { NextFunction, Request, Response } from 'express';
import { AuditLogService } from '../main/audit/services/auditLog.service';
import {
  findTrackedAction,
  REPORTED_ACTIONS,
} from '../main/audit/utils/trackedActions.utils';
import logger from '../utils/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readEntityId(req: Request, key: string): string | null {
  const value = req.params?.[key] ?? req.body?.[key] ?? req.query?.[key];
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

/** Records tracked actions after the response is sent, so it never delays one.
 *  The .catch is load-bearing: an unhandled rejection exits the process on Node 22. */
export const auditLog = (req: Request, res: Response, next: NextFunction) => {
  if (READ_METHODS.has(req.method)) return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.route) return;

    const tracked =
      REPORTED_ACTIONS[res.locals.auditAction] ??
      findTrackedAction(req.method, `${req.baseUrl}${req.route.path}`);
    // Login routes run before any req.user exists; their controllers set this.
    const userId: string | undefined = req.user?.id ?? res.locals.auditUserId;
    if (!tracked || !userId) return;

    AuditLogService.record({
      userId,
      clinicId: req.clinicId ?? null,
      action: tracked.action,
      entityId: tracked.idParam ? readEntityId(req, tracked.idParam) : null,
      ip: req.ip ?? null,
    }).catch((error) =>
      logger.warn(`[AuditLog] Failed to save ${tracked.action}`, error)
    );
  });

  next();
};
