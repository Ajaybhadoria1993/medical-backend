// Not in helpers.ts: that file is pure and imported by most engine tests,
// while this one pulls in Redis and the directory port.

import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import logger from '../../../utils/logger';
import { getDirectoryPort } from '../../notifications/ports';
import { name } from '../../notifications/registry/appointment/messages';

/** Names change rarely; the TTL only bounds a write no invalidation covers. */
const DOCTOR_NAME_TTL_SECONDS = 60 * 60;

/** Cleared via CacheKeys.doctorPublicProfileAll. Null on failure: a push with
 *  generic wording beats no push. */
export async function getDoctorDisplayName(
  doctorId: string | null | undefined
): Promise<string | null> {
  if (!doctorId) return null;
  try {
    return await getOrSetCache(
      CacheKeys.doctorDisplayName(doctorId),
      DOCTOR_NAME_TTL_SECONDS,
      async () => {
        const doctor = await getDirectoryPort().getUser(doctorId);
        const doctorName = doctor?.name.trim();
        return doctorName ? name(doctorName) : null;
      }
    );
  } catch (err) {
    logger.warn(
      `[DoctorDisplayName] Lookup failed for doctor=${doctorId}; using generic copy`,
      err
    );
    return null;
  }
}
