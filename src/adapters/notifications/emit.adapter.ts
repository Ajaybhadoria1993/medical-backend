/**
 * EmitPort implementation, backed by the live Socket.io server.
 *
 * The io instance is injected at boot rather than imported, because reaching
 * back into app.ts for the socket manager is the import cycle that made the
 * existing broadcast helpers call require() inline at emit time.
 *
 * If the notification worker ever runs as its own process, this is the one
 * file that changes: @socket.io/redis-emitter publishes into the same rooms
 * without holding any socket connections, which works because the Socket.io
 * Redis adapter is already in use.
 */

import type { Server } from 'socket.io';
import type { EmitPort } from '../../main/notifications/ports';
import logger from '../../utils/logger';

class SocketEmitAdapter implements EmitPort {
  private io: Server | null = null;

  attach(io: Server): void {
    this.io = io;
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    if (!this.io) {
      // Delivery is a hint; the row is already committed, so the client picks
      // it up on next load. Not worth throwing into a queue worker over.
      logger.warn(
        `[Notifications] emit skipped, socket server not attached (${event} -> ${room})`
      );
      return;
    }

    try {
      this.io.to(room).emit(event, payload);
    } catch (err) {
      logger.warn(`[Notifications] emit to ${room} failed`, err);
    }
  }
}

export const emitAdapter = new SocketEmitAdapter();
