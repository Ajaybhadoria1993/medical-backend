import type { DirectoryPort } from './directory.port';

export type { DirectoryPort };

let directory: DirectoryPort | null = null;

export function registerDirectoryPort(impl: DirectoryPort): void {
  directory = impl;
}

export function getDirectoryPort(): DirectoryPort {
  if (!directory) {
    throw new Error(
      '[Referral] DirectoryPort used before registration — call initReferralPorts() at boot.'
    );
  }
  return directory;
}
