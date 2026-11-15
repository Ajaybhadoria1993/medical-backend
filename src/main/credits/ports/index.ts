import type { ClinicPort } from './clinic.port';
import type { NotifyPort } from './notify.port';
import type { PlanPort } from './plan.port';

export type { ClinicPort, NotifyPort, PlanPort };

let plan: PlanPort | null = null;
let notify: NotifyPort | null = null;
let clinic: ClinicPort | null = null;

export function registerPlanPort(impl: PlanPort): void {
  plan = impl;
}

export function registerNotifyPort(impl: NotifyPort): void {
  notify = impl;
}

export function registerClinicPort(impl: ClinicPort): void {
  clinic = impl;
}

/** Throws rather than guessing a limit: a silent "unlimited" would hide a wiring bug. */
export function getPlanPort(): PlanPort {
  if (!plan) throw notRegistered('PlanPort');
  return plan;
}

export function getNotifyPort(): NotifyPort {
  if (!notify) throw notRegistered('NotifyPort');
  return notify;
}

export function getClinicPort(): ClinicPort {
  if (!clinic) throw notRegistered('ClinicPort');
  return clinic;
}

const notRegistered = (port: string) =>
  new Error(
    `[Credits] ${port} used before registration — call initCreditsPorts() at boot.`
  );
