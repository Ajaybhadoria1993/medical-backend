import { randomUUID } from 'crypto';
import path from 'path';
import logger from '../../utils/logger';

/** Tenant root used when a route establishes no clinic context. */
export const UNSCOPED_ROOT = 'unscoped';

/** Only what the key needs — multer-s3 hands over a narrower Request than Express. */
export interface KeyRequest {
  clinicId?: string;
  labId?: string;
  method?: string;
  baseUrl?: string;
  path?: string;
  route?: { path?: string };
  user?: { userType?: string };
}

/**
 * Builds the stored key for an upload.
 * Shape: {env}/c/{clinicId}/{category}/{yyyy}/{mm}/{uuid}{ext}
 */
export function buildObjectKey(
  req: KeyRequest,
  category: string,
  originalName: string
): string {
  const ext = path.extname(originalName).toLowerCase();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${tenantSegment(req, category)}/${category}/${year}/${month}/${randomUUID()}${ext}`;
}

/**
 * Clinic-scoped where the route provides one, explicitly unscoped otherwise.
 * The warning is how we learn which routes need `requireClinic` added.
 */
function tenantSegment(req: KeyRequest, category: string): string {
  const clinicId = req.clinicId;
  if (clinicId) return `c/${clinicId}`;

  const labId = req.labId;
  if (labId) return `lab/${labId}`;

  // Route and category only — a filename here would leak the patient name.
  logger.warn('[s3] upload has no tenant context', {
    method: req.method,
    route: `${req.baseUrl ?? ''}${req.route?.path ?? req.path ?? ''}`,
    category,
    userType: req.user?.userType ?? 'anonymous',
  });

  return UNSCOPED_ROOT;
}

/** Lowercased extension without the dot, for whitelist checks. */
export function fileExtension(originalName: string): string {
  return path.extname(originalName).toLowerCase().replace(/^\./, '');
}
