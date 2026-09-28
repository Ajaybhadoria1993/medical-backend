/**
 * RealtimeBus — the single seam through which the server says
 * "something changed", and the only thing it ever says.
 *
 * The bus carries a signal, never state:
 *
 *   { section, v, reason, at }        ~120 bytes
 *
 * It deliberately does not know what any screen displays. A client receiving
 * a signal refetches that section's existing REST snapshot, which stays the
 * one source of truth — so two screens reading the same section cannot
 * disagree, and a payload shape can never drift from the endpoint's.
 *
 * ── Client contract (frontend implements this) ───────────────────────────
 *
 * Each screen keeps the version of the data it currently holds, from the
 * `v` field its snapshot response carried. On a signal:
 *
 *   signal.v === localV   →  already current, ignore. No request.
 *   signal.v !== localV   →  refetch that section's snapshot once.
 *
 * The comparison is inequality, not "greater than", on purpose. A counter
 * that expires or is lost to a Redis flush restarts low; under a "greater
 * than" rule a client holding the old high number would ignore every
 * subsequent signal forever. Inequality self-heals — the cost is one extra
 * refetch when a signal arrives out of order, which simply re-reads current
 * truth and is harmless.
 *
 * Clients are expected to debounce (~250ms) so a burst of signals collapses
 * into one request, and to ignore signals while the page is hidden.
 *
 * ── Emitter contract (backend) ───────────────────────────────────────────
 *
 * Call notify() from the service layer, after the database write has
 * committed — never before, or a client can refetch and read pre-commit
 * state. Every call is fire-and-forget: failures are logged, never thrown,
 * and never affect the operation that triggered them.
 */

import type { Server } from 'socket.io';
import logger from '../../../utils/logger';
import { bumpVersion } from './streamVersion.service';
import type { RealtimeSignal, RealtimeTarget } from '../interfaces';
import { rooms } from '../utils/rooms';
import { target } from '../utils/sections';

/** The one event name every signal is emitted under. */
export const REALTIME_EVENT = 'realtime.section.changed';

class RealtimeBus {
  private io: Server | null = null;

  /**
   * Wires the bus to the live Socket.io server at boot.
   *
   * Injected rather than imported so emitters do not have to reach back into
   * app.ts for the socket manager — that import cycle is why the existing
   * broadcast services call require() inline at emit time.
   */
  attach(io: Server): void {
    this.io = io;
    logger.info('[Realtime] Bus attached to Socket.io server');
  }

  /**
   * Signals that a section changed.
   *
   * Fire-and-forget by design: returns void, resolves its own promise
   * internally, and swallows every error. Callers are on the request path of
   * a write that has already succeeded.
   */
  notify(targetRef: RealtimeTarget, reason: string): void {
    void this.emitSignal(targetRef, reason);
  }

  /**
   * Emits an event with custom payload to a room via Socket.io.
   */
  emitToRoom(room: string, event: string, payload: unknown): void {
    try {
      if (!this.io) {
        logger.warn(
          `[Realtime] Bus not attached; dropped event=${event} to room=${room}`
        );
        return;
      }
      this.io.to(room).emit(event, payload);
      logger.debug(`[Realtime] Emitted ${event} → ${room}`);
    } catch (err) {
      logger.warn(
        `[Realtime] Failed to emit event=${event} to room=${room}`,
        err
      );
    }
  }

  /**
   * Broadcasts auth session invalidation (password change/reset, onboarding reset) to a user's devices.
   * Signals the realtime bus for session section and emits 'auth.session_invalidated'.
   */
  notifySessionInvalidated(
    userId: string,
    reason:
      | 'PASSWORD_CHANGED'
      | 'PASSWORD_RESET'
      | 'ONBOARDING_RESET'
      | 'CLINIC_DELETED',
    validToken?: string
  ): void {
    this.notify(target.session(userId), reason.toLowerCase());
    this.emitToRoom(rooms.user(userId), 'auth.session_invalidated', {
      reason,
      validToken,
    });
  }

  private async emitSignal(
    { section, room }: RealtimeTarget,
    reason: string
  ): Promise<void> {
    try {
      if (!this.io) {
        logger.warn(
          `[Realtime] Bus not attached; dropped signal section=${section} reason=${reason}`
        );
        return;
      }

      const v = await bumpVersion(section);

      // No version means Redis is unreachable. Staying silent is the correct
      // failure mode: a signal without a trustworthy version would either be
      // ignored by every client or make every client refetch at once.
      if (v === null) {
        logger.warn(
          `[Realtime] No version available; dropped signal section=${section}`
        );
        return;
      }

      const signal: RealtimeSignal = {
        section,
        v,
        reason,
        at: new Date().toISOString(),
      };

      this.io.to(room).emit(REALTIME_EVENT, signal);

      logger.debug(`[Realtime] ${section} v${v} (${reason}) → ${room}`);
    } catch (err) {
      logger.warn(
        `[Realtime] Failed to emit signal for section=${section}`,
        err
      );
    }
  }
}

export const realtimeBus = new RealtimeBus();
