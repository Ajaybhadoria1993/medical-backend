import type { ClinicPort } from './clinic.port';

export type { BillingClinic, BillingParty, ClinicPort } from './clinic.port';

let clinic: ClinicPort | null = null;

export function registerClinicPort(impl: ClinicPort): void {
  clinic = impl;
}

/** Throws rather than guessing: a missing clinic lookup would print blank invoices. */
export function getClinicPort(): ClinicPort {
  if (!clinic) {
    throw new Error(
      '[Subscription] ClinicPort used before registration — call initSubscriptionPorts() at boot.'
    );
  }
  return clinic;
}
