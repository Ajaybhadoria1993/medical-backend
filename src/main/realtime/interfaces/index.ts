/**
 * Realtime Engine — shared types.
 */

/** A section paired with the socket room its signal is emitted to. */
export interface RealtimeTarget {
  /** Stable id the client keys its local version off. */
  section: string;
  /** Socket.io room the signal is emitted to. */
  room: string;
}

/**
 * The only shape the engine ever puts on the wire.
 *
 * It carries no state — if a screen needs data, it has an endpoint. Adding a
 * data field here would give the frontend a second source of truth alongside
 * the REST snapshot, which is the exact failure this design removes.
 */
export interface RealtimeSignal {
  section: string;
  v: number;
  /** What happened, for logs and debugging. Never branch on it. */
  reason: string;
  at: string;
}
