/**
 * Hold flags — Redis only.
 *
 * "On hold" says a checked-in patient is not available right now. It is not an
 * appointment status: the appointment stays `Patient Arrived` throughout, so
 * nothing in billing, reporting or the appointment engine has to learn a new
 * value, and resuming needs no memory of what the status used to be.
 *
 * Redis rather than a table because a hold is meaningless tomorrow — the key
 * is date-scoped and expires on its own. If Redis is lost the holds clear and
 * those patients simply rejoin the waiting list, which is the safe direction:
 * reception sees them again rather than losing them.
 */

import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';

const TTL_SECONDS = 36 * 60 * 60;

/**
 * Why a patient is parked. Both reasons produce the same state, so the reason
 * is the only thing that can tell a hold from a skip after the fact.
 */
export type HoldReason = 'held' | 'skipped';

function holdKey(clinicId: string, doctorId: string, date: string): string {
  return `queue:hold:${clinicId}:${doctorId}:${date}`;
}

/**
 * Flags an appointment as unavailable, recording why. Idempotent; a later call
 * overwrites the reason, which is what should happen when a held patient is
 * then skipped.
 */
export async function holdAppointment(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string,
  reason: HoldReason = 'held'
): Promise<void> {
  const key = holdKey(clinicId, doctorId, date);
  await redisClient.hset(key, appointmentId, reason);
  await redisClient.expire(key, TTL_SECONDS);
}

/** Clears the flag. Idempotent — resuming a patient who is not held is a no-op. */
export async function resumeAppointment(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string
): Promise<void> {
  await redisClient.hdel(holdKey(clinicId, doctorId, date), appointmentId);
}

/**
 * The set of held appointment ids for a doctor's day.
 *
 * Returns an empty map if Redis is unreachable. That is deliberate: a board
 * that renders every patient as waiting is recoverable at a glance, whereas
 * failing the whole request would take the queue screen down over a flag.
 */
export async function getHeldAppointments(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<Map<string, HoldReason>> {
  const key = holdKey(clinicId, doctorId, date);
  try {
    const entries = await redisClient.hgetall(key);
    return new Map(
      Object.entries(entries ?? {}).map(([id, reason]) => [
        id,
        reason === 'skipped' ? 'skipped' : 'held',
      ])
    );
  } catch (err) {
    // Holds were a SET before reasons were recorded, and Redis answers
    // HGETALL on one with WRONGTYPE. Drop the stale key — same-day data, so
    // the cost is a few patients rejoining the waiting list.
    if (String((err as Error)?.message ?? '').includes('WRONGTYPE')) {
      await redisClient.del(key).catch(() => {});
      logger.info(
        `[Queue] Cleared pre-reason hold set for clinic=${clinicId} doctor=${doctorId} date=${date}`
      );
      return new Map();
    }
    logger.warn(
      `[Queue] Failed to read holds for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return new Map();
  }
}

/* ── Who is in the room ─────────────────────────────────────────────────── */

function currentKey(clinicId: string, doctorId: string, date: string): string {
  return `queue:current:${clinicId}:${doctorId}:${date}`;
}

/**
 * The patient with the doctor — a pointer, not a status. `Confirmed` means the
 * *booking* was confirmed, which is a different fact and not reception's to
 * assert. Date-scoped and self-expiring, like holds: losing it reads as an
 * empty room, which is recoverable at a glance.
 */
export async function setCurrentAppointment(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string
): Promise<void> {
  const key = currentKey(clinicId, doctorId, date);
  await redisClient.set(key, appointmentId, 'EX', TTL_SECONDS);
}

/** Empties the room. Idempotent. */
export async function clearCurrentAppointment(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<void> {
  await redisClient.del(currentKey(clinicId, doctorId, date));
}

/** Null on a Redis failure: an empty room is recoverable, a failed request is not. */
export async function getCurrentAppointmentId(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<string | null> {
  try {
    return await redisClient.get(currentKey(clinicId, doctorId, date));
  } catch (err) {
    logger.warn(
      `[Queue] Failed to read current patient for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return null;
  }
}

function startedAtKey(
  clinicId: string,
  doctorId: string,
  date: string
): string {
  return `queue:startedAt:${clinicId}:${doctorId}:${date}`;
}

/** Records when the room pointer above was last set, for an accurate elapsed-time display. */
export async function setConsultationStartedAt(
  clinicId: string,
  doctorId: string,
  date: string,
  iso: string
): Promise<void> {
  await redisClient.set(
    startedAtKey(clinicId, doctorId, date),
    iso,
    'EX',
    TTL_SECONDS
  );
}

/** Clears the timer. Idempotent. */
export async function clearConsultationStartedAt(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<void> {
  await redisClient.del(startedAtKey(clinicId, doctorId, date));
}

function endedAtKey(clinicId: string, doctorId: string, date: string): string {
  return `queue:endedAt:${clinicId}:${doctorId}:${date}`;
}

/**
 * When the doctor last finished with someone.
 *
 * Kept so the projection can move *earlier*. The engine cascades each patient
 * from the previous one's planned end, so a 30-minute slot finished in 15 left
 * everyone behind projected from 30 — the fifteen minutes freed were invisible.
 * With a real end recorded, an empty room anchors the cascade to when the
 * doctor actually became free.
 *
 * One key per doctor-day, like the start: only the most recent finish matters,
 * since anyone still waiting is waiting on the room being free *now*.
 */
export async function setConsultationEndedAt(
  clinicId: string,
  doctorId: string,
  date: string,
  iso: string
): Promise<void> {
  try {
    await redisClient.set(
      endedAtKey(clinicId, doctorId, date),
      iso,
      'EX',
      TTL_SECONDS
    );
  } catch (err) {
    logger.warn(
      `[Queue] Failed to record consultation end for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
  }
}

/**
 * Ends the consultation and empties the room, only when `appointmentId` is the
 * one in it. Id-guarded and idempotent: safe from every completion path.
 */
export async function endConsultationIfOccupant(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string
): Promise<boolean> {
  try {
    const occupant = await getCurrentAppointmentId(clinicId, doctorId, date);
    if (occupant !== appointmentId) return false;

    // End instant first: the projection cascade re-anchors to it.
    await setConsultationEndedAt(
      clinicId,
      doctorId,
      date,
      new Date().toISOString()
    );
    await clearCurrentAppointment(clinicId, doctorId, date);
    await clearConsultationStartedAt(clinicId, doctorId, date);
    return true;
  } catch (err) {
    logger.warn(
      `[Queue] Failed to end consultation for appointment=${appointmentId} ` +
        `clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return false;
  }
}

/** Null on a Redis failure — the projection falls back to planned durations. */
export async function getConsultationEndedAt(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<string | null> {
  try {
    return await redisClient.get(endedAtKey(clinicId, doctorId, date));
  } catch (err) {
    logger.warn(
      `[Queue] Failed to read consultation end for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return null;
  }
}

/** Null on a Redis failure — an accurate timer is a nicety, not worth failing the request over. */
export async function getConsultationStartedAt(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<string | null> {
  try {
    return await redisClient.get(startedAtKey(clinicId, doctorId, date));
  } catch (err) {
    logger.warn(
      `[Queue] Failed to read consultation start time for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return null;
  }
}

/* ── Who is up next ─────────────────────────────────────────────────────── */

function nextKey(clinicId: string, doctorId: string, date: string): string {
  return `queue:next:${clinicId}:${doctorId}:${date}`;
}

/** Redis refusing a list command against a key of another type. */
function isWrongType(err: unknown): boolean {
  return err instanceof Error && err.message.includes('WRONGTYPE');
}

/**
 * Upgrades a key left over from when this held a single appointment id.
 *
 * The override became a list, but keys written by the previous release are
 * strings and live for 36 hours — so every environment carries some across the
 * deploy, and the first list command against one fails with WRONGTYPE. That is
 * a live queue: doing this lazily, on the first command that trips, means no
 * migration step to run and no window where the day's promotions are lost.
 *
 * The promotion itself is preserved where it can be read; anything else is
 * dropped, since plain token order is the safe fallback.
 *
 * @returns the ids in the key afterwards.
 */
async function upgradeLegacyNextKey(key: string): Promise<string[]> {
  let legacyId: string | null = null;
  try {
    legacyId = await redisClient.get(key);
  } catch {
    // Some other type entirely — nothing worth keeping.
  }

  await redisClient.del(key);

  if (!legacyId) return [];

  await redisClient.rpush(key, legacyId);
  await redisClient.expire(key, TTL_SECONDS);
  logger.info(`[Queue] Upgraded legacy single-id next key to a list: ${key}`);
  return [legacyId];
}

/**
 * Reception's running order for the front of the queue — the one deliberate
 * override of token order.
 *
 * A list, not a single id, because "set as next" has to be repeatable without
 * undoing itself. It used to be one key holding one appointment: promoting a
 * second patient overwrote the first, who did not move down one place but fell
 * all the way back to their token position. Reception saw a queue they had
 * ordered rearrange itself behind their backs.
 *
 * Head of the list is the front of the queue. Everyone not named keeps plain
 * token order behind them, so promoting one patient pushes each of the others
 * down exactly one place.
 */
export async function setNextAppointment(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string
): Promise<void> {
  const key = nextKey(clinicId, doctorId, date);

  // LREM first so promoting somebody already in the list moves them rather
  // than listing them twice — the list is an order, not a log.
  const promote = () =>
    redisClient
      .multi()
      .lrem(key, 0, appointmentId)
      .lpush(key, appointmentId)
      .expire(key, TTL_SECONDS)
      .exec();

  // MULTI reports per-command errors in its results instead of rejecting, so
  // a WRONGTYPE here would otherwise be a silent no-op — the promotion would
  // appear to succeed and change nothing.
  const results = await promote();
  const hitLegacyKey = (results ?? []).some(([err]) => isWrongType(err));

  if (hitLegacyKey) {
    await upgradeLegacyNextKey(key);
    await promote();
  }
}

/**
 * Drops one patient from the override, leaving the rest of reception's order
 * intact — for when that patient has gone in to the doctor and their promotion
 * has been honoured. Clearing the whole list here would discard the ordering
 * of everybody still waiting behind them.
 */
export async function removeNextAppointment(
  clinicId: string,
  doctorId: string,
  date: string,
  appointmentId: string
): Promise<void> {
  const key = nextKey(clinicId, doctorId, date);
  try {
    await redisClient.lrem(key, 0, appointmentId);
  } catch (err) {
    if (!isWrongType(err)) throw err;
    // A key from the previous release still holding a single id. Upgrading it
    // and retrying is what keeps any *other* promotion on it alive.
    await upgradeLegacyNextKey(key);
    await redisClient.lrem(key, 0, appointmentId);
  }
}

/**
 * Reception's order, front first. Empty on a Redis failure — plain token order
 * is the safe fallback.
 */
export async function getNextAppointmentIds(
  clinicId: string,
  doctorId: string,
  date: string
): Promise<string[]> {
  const key = nextKey(clinicId, doctorId, date);
  try {
    return await redisClient.lrange(key, 0, -1);
  } catch (err) {
    // A key written by the previous release, which held one id as a string.
    // Upgrade it in place and answer from the result — the board is read far
    // more often than it is written, so this is usually where the conversion
    // happens, and it must return the promotion rather than lose it.
    if (isWrongType(err)) {
      try {
        return await upgradeLegacyNextKey(key);
      } catch (upgradeErr) {
        logger.warn(
          `[Queue] Failed to upgrade legacy next key for clinic=${clinicId} doctor=${doctorId}`,
          upgradeErr
        );
        return [];
      }
    }

    logger.warn(
      `[Queue] Failed to read next patients for clinic=${clinicId} doctor=${doctorId}`,
      err
    );
    return [];
  }
}
