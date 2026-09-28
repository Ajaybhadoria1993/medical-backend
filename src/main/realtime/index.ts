/**
 * Realtime Engine
 *
 * System-wide realtime synchronisation. The server emits a signal saying a
 * named section of state changed and which version it moved to; clients
 * refetch that section's existing REST snapshot. The socket never carries
 * state, so the snapshot endpoint stays the single source of truth.
 *
 * See docs/REALTIME_SIGNAL_CONTRACT.md for the full contract.
 */

export { realtimeBus, REALTIME_EVENT } from './services/realtimeBus.service';
export { readVersion, bumpVersion } from './services/streamVersion.service';
export { target } from './utils/sections';
export { rooms } from './utils/rooms';
export { signalAppointmentChange } from './utils/signalAppointmentChange';
export { signalLabChange } from './utils/signalLabChange';
export type { RealtimeSignal, RealtimeTarget } from './interfaces';
