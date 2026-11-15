/**
 * Wires the notification module's ports to their implementations.
 *
 * Called once at boot. Until this runs, reading a port throws — deliberately,
 * because a notification that silently resolves to no recipients is far harder
 * to notice than a failed boot.
 */

import type { Server } from 'socket.io';
import {
  registerAttachmentPort,
  registerDirectoryPort,
  registerEmitPort,
} from '../../main/notifications/ports';
import { attachmentAdapter } from './attachment.adapter';
import { directoryAdapter } from './directory.adapter';
import { emitAdapter } from './emit.adapter';

export function initNotificationPorts(io: Server): void {
  emitAdapter.attach(io);
  registerDirectoryPort(directoryAdapter);
  registerEmitPort(emitAdapter);
  registerAttachmentPort(attachmentAdapter);
}
