/**
 * Real-time delivery, as a contract.
 *
 * In-process this is the Socket.io server. From a separate worker or an
 * extracted service it becomes @socket.io/redis-emitter, which publishes into
 * the same rooms without holding any socket connections — possible because the
 * Socket.io Redis adapter is already in use. Swapping one for the other must not
 * touch anything that emits.
 */
export interface EmitPort {
  emitToRoom(room: string, event: string, payload: unknown): void;
}
