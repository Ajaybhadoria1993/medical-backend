// Public surface of the module: code outside main/treatmentPlan imports only from here.
import { PlanBookingService } from './services/plans/planBooking.service';
import { PlanLifecycleService } from './services/plans/planLifecycle.service';
import { PlanQueryService } from './services/plans/planQuery.service';
import { LibrarySeedService } from './services/templates/librarySeed.service';
import type { AppointmentChangedEvent } from './types/appointmentSync.types';
import { PlanDecisionService } from './services/plans/planDecision.service';
import type { PlanFollowUp as PlanCallBody } from './schemas/plan.schema';
import type {
  PlanConsentForm,
  PlanDeskCall,
  PlanFollowUp,
  PrescriptionPlan,
} from './types/plan.types';
import type { Actor } from './types/template.types';

export { CALL_OUTCOMES } from './schemas/plan.schema';
export type {
  PlanConsentForm,
  PlanDeskCall,
  PlanFollowUp,
  PrescriptionPlan,
} from './types/plan.types';

export {
  registerAppointmentPort,
  registerDoctorPort,
  registerFilePort,
  registerPatientPort,
  registerStaffScopePort,
} from './ports';
export type {
  AppointmentPort,
  BookingOption,
  DoctorPort,
  FilePort,
  PatientPort,
  PlanAppointment,
  StaffScopePort,
} from './ports';
export type {
  AppointmentChangeKind,
  AppointmentChangedEvent,
} from './types/appointmentSync.types';

/** Call after an appointment commit. Never throws: missed / cancelled / moved visits update their plan steps (§7). */
export function onAppointmentChanged(
  event: AppointmentChangedEvent
): Promise<void> {
  return PlanBookingService.onAppointmentChanged(event);
}

/** For writers that skip onAppointmentChanged (the day-end no-show job): frees steps on dead visits. */
export function syncTreatmentPlanDeadVisits(): Promise<number> {
  return PlanBookingService.syncDeadVisits();
}

/** True when the visit belongs to a plan ended for a sensitive reason: send it no reminder (6.4). */
export function isSilencedTreatmentVisit(
  appointmentId: string
): Promise<boolean> {
  return PlanLifecycleService.isSilencedVisit(appointmentId);
}

/** Plans suggested at this visit, as its prescription prints them (no money). Empty when none. */
export function prescriptionPlans(
  clinicId: string,
  patientId: string,
  appointmentId: string
): Promise<PrescriptionPlan[]> {
  return PlanQueryService.forPrescription(clinicId, patientId, appointmentId);
}

/** Plans waiting for an answer and under way, for the clinic dashboard card. */
export function treatmentPlanStatusCounts(clinicId: string) {
  return PlanQueryService.statusCounts(clinicId);
}

/** Plan visits to book, call-backs and check-ups due in an IST day range, scoped to what the actor may see.
 *  patientIds narrows to those patients (a name search); null = everyone. */
export function planFollowUps(
  clinicId: string,
  actor: Actor,
  from: string,
  to: string,
  limit: number,
  patientIds: string[] | null = null
): Promise<PlanFollowUp[]> {
  return PlanQueryService.dueFollowUps(
    clinicId,
    actor,
    from,
    to,
    limit,
    patientIds
  );
}

/** Logs a desk call on a plan (same record as the plan page's call log). Throws HttpError 409 on a finished plan. */
export async function logPlanCall(
  clinicId: string,
  actor: Actor,
  planId: string,
  body: PlanCallBody
): Promise<void> {
  await PlanDecisionService.logCall(clinicId, actor, planId, body);
}

/** Logged calls on the given plans, newest first, scoped to what the actor may see. */
export function planCalls(
  clinicId: string,
  actor: Actor,
  planIds: string[]
): Promise<PlanDeskCall[]> {
  return PlanQueryService.calls(clinicId, actor, planIds);
}

/** Takes one plan row off the desk follow-up list, recorded in the plan's history. Throws HttpError 404 outside scope. */
export function dismissPlanFollowUp(
  clinicId: string,
  actor: Actor,
  planId: string,
  kind: string,
  refId: string,
  reason: string
): Promise<void> {
  return PlanDecisionService.dismissFollowUp(
    clinicId,
    actor,
    planId,
    kind,
    refId,
    reason
  );
}

export function isPlanVisible(
  clinicId: string,
  actor: Actor,
  planId: string
): Promise<boolean> {
  return PlanQueryService.isVisible(clinicId, actor, planId);
}

/** Ready-made templates for the seed script; inserts missing codes only, safe to rerun. */
export const seedTreatmentTemplates = () => LibrarySeedService.run();

/** Platform plan / step field sets per specialty for the seed script; missing ones only. */
export const seedTreatmentSpecialtyConfigs = () =>
  LibrarySeedService.runSpecialtyConfigs();

/** Signed consent forms on a patient's plans, scoped to what the actor may see. */
export function planConsentForms(
  clinicId: string,
  actor: Actor,
  patientId: string
): Promise<PlanConsentForm[]> {
  return PlanQueryService.consentForms(clinicId, actor, patientId);
}

/** Stored key of a plan's consent form the actor may see, or null; for the files module to sign. */
export function planConsentLocation(
  planId: string,
  clinicId: string,
  actor: Actor
): Promise<string | null> {
  return PlanQueryService.consentLocation(planId, clinicId, actor);
}
