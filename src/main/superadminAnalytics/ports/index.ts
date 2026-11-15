import type { SourceDataPort } from './sourceData.port';
import type { WhatsAppMessagesPort } from './whatsappMessages.port';
import type { PlatformFeesPort } from './platformFees.port';

export type { SourceDataPort, WhatsAppMessagesPort, PlatformFeesPort };

let sourceData: SourceDataPort | null = null;
let whatsappMessages: WhatsAppMessagesPort | null = null;
let platformFees: PlatformFeesPort | null = null;

export function registerSourceDataPort(impl: SourceDataPort): void {
  sourceData = impl;
}

export function registerWhatsAppMessagesPort(impl: WhatsAppMessagesPort): void {
  whatsappMessages = impl;
}

export function getWhatsAppMessagesPort(): WhatsAppMessagesPort {
  if (!whatsappMessages) {
    throw new Error(
      '[SuperadminAnalytics] WhatsAppMessagesPort used before registration — call initSuperadminAnalyticsPorts() at boot.'
    );
  }
  return whatsappMessages;
}

/** Throws rather than returning empty data: silent zeros on a dashboard look real. */
export function getSourceDataPort(): SourceDataPort {
  if (!sourceData) {
    throw new Error(
      '[SuperadminAnalytics] SourceDataPort used before registration — call initSuperadminAnalyticsPorts() at boot.'
    );
  }
  return sourceData;
}

export function registerPlatformFeesPort(impl: PlatformFeesPort): void {
  platformFees = impl;
}

export function getPlatformFeesPort(): PlatformFeesPort {
  if (!platformFees) {
    throw new Error(
      '[SuperadminAnalytics] PlatformFeesPort used before registration — call initSuperadminAnalyticsPorts() at boot.'
    );
  }
  return platformFees;
}
