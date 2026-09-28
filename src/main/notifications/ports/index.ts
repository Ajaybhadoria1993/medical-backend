/**
 * Port wiring.
 *
 * Implementations are registered once at boot from outside the module, so
 * nothing here has a compile-time dependency on another feature. Reading a port
 * before it is registered is a programming error, not a runtime condition, so
 * it throws rather than degrading quietly — a notification that silently
 * resolves to no recipients is far harder to notice than a failed boot.
 */

import type { DirectoryPort } from './directory.port';
import type { EmitPort } from './emit.port';

export type { DirectoryPort, EmitPort };
export type {
  NotificationUser,
  ChannelSettings,
  AppointmentContext,
} from './directory.port';

let directory: DirectoryPort | null = null;
let emitter: EmitPort | null = null;

export function registerDirectoryPort(impl: DirectoryPort): void {
  directory = impl;
}

export function registerEmitPort(impl: EmitPort): void {
  emitter = impl;
}

export function getDirectoryPort(): DirectoryPort {
  if (!directory) {
    throw new Error(
      '[Notifications] DirectoryPort used before registration — call registerDirectoryPort() at boot.'
    );
  }
  return directory;
}

export function getEmitPort(): EmitPort {
  if (!emitter) {
    throw new Error(
      '[Notifications] EmitPort used before registration — call registerEmitPort() at boot.'
    );
  }
  return emitter;
}
