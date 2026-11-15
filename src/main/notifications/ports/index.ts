/** Ports are registered once at boot from outside, so nothing here depends on another feature at compile time.
 *  Reading one before registration throws: silently having no recipients is harder to notice than a failed boot. */

import type { DirectoryPort } from './directory.port';
import type { EmitPort } from './emit.port';

export type { DirectoryPort, EmitPort };
export type {
  NotificationUser,
  ChannelSettings,
  AppointmentContext,
} from './directory.port';

export type {
  AttachmentPort,
  EmailAttachmentRef,
  ResolvedAttachment,
} from './attachment.port';
import type { AttachmentPort } from './attachment.port';

let directory: DirectoryPort | null = null;
let emitter: EmitPort | null = null;
let attachments: AttachmentPort | null = null;

export function registerAttachmentPort(impl: AttachmentPort): void {
  attachments = impl;
}

/** Optional: an email still goes out without its file when no provider is registered. */
export function getAttachmentPort(): AttachmentPort | null {
  return attachments;
}

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
