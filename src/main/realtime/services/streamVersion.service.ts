/**
 * Per-section version counter.
 *
 * One Redis INCR per state change is the whole server-side cost of a realtime
 * signal — no database read, and no payload to build. The number it returns
 * is what lets a client answer "am I behind?" without the server keeping a
 * replay buffer of what each client has seen.
 *
 * TTL is 36h. Queue sections are date-scoped, so yesterday's counters expire
 * on their own rather than accumulating.
 */

import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

const PREFIX = 'rt:v';
const TTL_SECONDS = 36 * 60 * 60;

function key(section: string): string {
  return `${PREFIX}:${section}`;
}

/**
 * Increments and returns the section's version.
 *
 * INCR and EXPIRE go in one pipeline so this stays a single round trip.
 * EXPIRE is re-applied on every bump, which slides the window forward for a
 * section that is still active — an all-day queue never expires mid-day.
 *
 * Returns null if Redis is unreachable. Callers must treat that as "skip the
 * signal", never as version 0: emitting a signal without a real version would
 * tell every client it is out of sync.
 */
export async function bumpVersion(section: string): Promise<number | null> {
  try {
    const results = await redisClient
      .pipeline()
      .incr(key(section))
      .expire(key(section), TTL_SECONDS)
      .exec();

    const incr = results?.[0];
    if (!incr || incr[0]) return null;

    const value = Number(incr[1]);
    return Number.isFinite(value) ? value : null;
  } catch (err) {
    logger.warn(
      `[Realtime] Failed to bump version for section=${section}`,
      err
    );
    return null;
  }
}

/**
 * Reads the section's current version without incrementing.
 *
 * Used by the REST snapshot endpoints so a response can carry the version of
 * the state it is returning. Returns 0 when the key is absent — a section
 * nothing has changed yet is legitimately at version 0.
 *
 * Note the read happens *after* the snapshot is built, so a change landing
 * mid-build yields a version one higher than the data. That direction is the
 * safe one: the client sees a version it does not match and refetches. The
 * reverse (reading first) would let it believe stale data was current.
 */
export async function readVersion(section: string): Promise<number> {
  try {
    const raw = await redisClient.get(key(section));
    if (raw === null) return 0;
    const value = parseInt(raw, 10);
    return Number.isFinite(value) ? value : 0;
  } catch (err) {
    logger.warn(
      `[Realtime] Failed to read version for section=${section}`,
      err
    );
    return 0;
  }
}
