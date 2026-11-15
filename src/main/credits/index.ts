// Public surface of the module: code outside main/credits imports only from here.
import { ExpiryService } from './services/core/expiry.service';
import { GrantsService } from './services/core/grants.service';
import { PacksService } from './services/core/packs.service';
import { CreditSettingsService } from './services/core/settings.service';
import { DeliveryService } from './services/messaging/delivery.service';
import { UsageService } from './services/messaging/usage.service';
import type { DeliveryReport, RecordSentInput } from './types/credits.types';
import type { CreditType, MessageChannel } from './utils/creditTypes.utils';

export {
  registerClinicPort,
  registerNotifyPort,
  registerPlanPort,
} from './ports';
export type { ClinicPort, NotifyPort, PlanPort } from './ports';
export type {
  CheckSendResult,
  DeliveryReport,
  ExpiryAlert,
  MessageLimit,
  RecordSentInput,
  UsageAlert,
} from './types/credits.types';
export type { CreditType, MessageChannel } from './utils/creditTypes.utils';

/** Call just before sending. Fails open, so a lookup error never blocks a message. */
export const checkSend = (
  clinicId: string,
  channel: MessageChannel,
  templateKey: string
) => UsageService.checkSend(clinicId, channel, templateKey);

/** Call after Meta accepts a message. Never throws. */
export const recordSent = (input: RecordSentInput) =>
  UsageService.recordSent(input);

/** Call for each status in Meta's webhook. Never throws. */
export const recordDeliveryStatus = (report: DeliveryReport) =>
  DeliveryService.record(report);

/** Daily cron: reminds admins of credits about to expire, once per grant. Safe to rerun. */
export const runCreditExpiryReminders = () => ExpiryService.runReminders();

/** Default settings per credit type, for the seed script; safe to rerun. */
export const seedCreditSettings = () => CreditSettingsService.seedDefaults();

/** Default credit packs per credit type, for the seed script; safe to rerun. */
export const seedCreditPacks = () => PacksService.seedDefaults();

/** Packs a clinic can buy now. */
export const listPacksOnSale = (creditType: CreditType) =>
  PacksService.onSale(creditType);

/** A pack on sale, for a checkout to copy its price and credits. */
export const getPackForSale = (packId: string) => PacksService.forSale(packId);

/** Adds the credits of a paid purchase once per payment. */
export const grantPurchasedCredits = (input: {
  clinicId: string;
  creditType: CreditType;
  credits: number;
  paymentId: string;
  reason: string;
}) => GrantsService.grantPurchase(input);

/** A refunded pack: its unused credits end now; returns how many. */
export const revokePurchasedCredits = (
  paymentId: string,
  reason: string,
  byUserId: string
) => GrantsService.revokePurchase(paymentId, reason, byUserId);
