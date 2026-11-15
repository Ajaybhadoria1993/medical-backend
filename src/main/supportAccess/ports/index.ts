import type { AccountPort } from './account.port';
import type { FilePort } from './file.port';

export type { AccountPort, FilePort };

let account: AccountPort | null = null;
let file: FilePort | null = null;

export function registerAccountPort(impl: AccountPort): void {
  account = impl;
}

export function registerFilePort(impl: FilePort): void {
  file = impl;
}

export function getAccountPort(): AccountPort {
  if (!account) throw notRegistered('AccountPort');
  return account;
}

/** Throws rather than letting files through unmasked when wiring is missing. */
export function getFilePort(): FilePort {
  if (!file) throw notRegistered('FilePort');
  return file;
}

const notRegistered = (port: string) =>
  new Error(
    `[SupportAccess] ${port} used before registration — call initSupportAccessPorts() at boot.`
  );
