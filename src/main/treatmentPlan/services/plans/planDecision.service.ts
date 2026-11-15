import { and, asc, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { getISTDateString } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  TreatmentPlanVersionModel as Version,
  type TreatmentPlan,
} from '../../models/treatmentPlan.model';
import { getFilePort } from '../../ports';
import type { PlanDecision, PlanFollowUp } from '../../schemas/plan.schema';
import type { PlanDetail } from '../../types/plan.types';
import type { Actor } from '../../types/template.types';
import { fromPaise, toPaise } from '../../utils/money.utils';
import { snapshotOf } from '../../utils/snapshot.utils';
import { addDays } from '../../utils/timing.utils';
import { TreatmentHistoryService } from '../history.service';
import { TreatmentPlanSettingsService } from '../settings.service';
import { PlanBookingService } from './planBooking.service';
import { PlanLedgerService } from './planLedger.service';
import { PlanQueryService } from './planQuery.service';
import { signalPlanMoney } from '../../utils/moneySignal.utils';
import { PlanMoneyStore } from './planMoney.service';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Accept = Extract<PlanDecision, { decision: 'accept' }>;

// Q28: a review has no package price, so it is paid visit by visit.
const REVIEW_BILLING: string[] = ['per_visit', 'advance_per_visit'];

// Calls are logged while the patient decides, and after a "no" to win them back.
// Calls are logged while the patient decides, during treatment, and for a finished plan's check-up.
const CALLABLE = [
  'proposed',
  'declined',
  'accepted',
  'in_treatment',
  'paused',
  'completed',
] as const;

/** The patient's answer to a suggested plan and the follow-up around it (DEV_PLAN 3.1–3.3). */
export class PlanDecisionService {
  static async decide(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanDecision,
    consentFile: string | null
  ): Promise<PlanDetail> {
    try {
      if (body.decision === 'accept')
        return await this.accept(clinicId, actor, planId, body, consentFile);
      if (consentFile)
        throw new HttpError(422, 'A consent form is only taken when accepting');
      return body.decision === 'think'
        ? await this.think(
            clinicId,
            actor,
            planId,
            body.followUpDate,
            body.notes
          )
        : await this.decline(
            clinicId,
            actor,
            planId,
            body.reason,
            body.followUpDate
          );
    } catch (err) {
      // The upload ran before this save; a save that failed must not leave the patient's file in S3.
      if (consentFile) await discardUpload(consentFile, planId);
      throw err;
    }
  }

  /** Locks the plan as version 1 with its payment way, advance and consent; other options are declined. */
  private static async accept(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: Accept,
    consentFile: string | null
  ): Promise<PlanDetail> {
    // A retry of an accept whose advance is already recorded gets that result, never a second advance.
    const repeat = await PlanMoneyStore.repeat(
      database,
      clinicId,
      body.requestId
    );
    if (repeat) {
      // The first accept kept its own file; this retry's copy is not needed.
      if (consentFile) await discardUpload(consentFile, planId);
      return PlanQueryService.get(clinicId, actor, repeat.sourceId);
    }

    const settings = await TreatmentPlanSettingsService.get(clinicId);
    if (!settings.billingModes.includes(body.billingMode))
      throw new HttpError(422, "Choose one of the clinic's payment options");
    const scope = await PlanQueryService.visible(clinicId, actor);

    const { plan, steps } = await database.transaction(async (tx) => {
      const current = await this.lockAnswerable(tx, planId, scope, true);
      if (
        current.planType === 'review' &&
        !REVIEW_BILLING.includes(body.billingMode)
      )
        throw new HttpError(
          422,
          'A review plan is paid per visit, with or without an advance'
        );
      if (
        !current.instalmentsAllowed &&
        body.billingMode === 'package_instalments'
      )
        throw new HttpError(
          422,
          "This plan's template doesn't allow instalments. Choose another way to pay"
        );
      if (current.consentRequired && !consentFile)
        throw new HttpError(
          422,
          'Upload the signed consent form to accept this plan'
        );
      const advancePaise = toPaise(body.advanceAmount);
      if (advancePaise > toPaise(current.totalAmount))
        throw new HttpError(422, 'The advance is more than the plan total');

      const today = getISTDateString();
      const [plan] = await tx
        .update(P)
        .set({
          status: 'accepted',
          billingMode: body.billingMode,
          advanceAmount: fromPaise(advancePaise),
          consentFileUrl: consentFile,
          acceptedAt: new Date(),
          followUpDate: null,
          endReason: null,
          packageExpiresOn:
            current.planType === 'package' && current.packageExpiryDays
              ? addDays(today, current.packageExpiryDays)
              : null,
        })
        .where(eq(P.id, current.id))
        .returning();
      // Step 1 becomes bookable from today (and the plan joins "Needs booking"); read the steps after.
      await PlanBookingService.recompute(tx, plan);
      const steps = await tx
        .select()
        .from(PlanStep)
        .where(eq(PlanStep.planId, plan.id))
        .orderBy(asc(PlanStep.seq));
      await tx.insert(Version).values({
        clinicId,
        planId: plan.id,
        version: 1,
        snapshot: snapshotOf(plan, steps),
        createdBy: actor.id,
      });
      if (body.instalments?.length)
        await PlanLedgerService.createInstalments(tx, plan, body.instalments);
      if (advancePaise > 0)
        await PlanMoneyStore.record(tx, plan, {
          entryType: 'advance',
          amountPaise: advancePaise,
          paymentMode: body.paymentMode!,
          requestId: body.requestId,
          createdBy: actor.id,
        });
      // After the advance, so today's desk payment is capped by what is really left to pay.
      if (plan.consultationStepSeq && plan.consultationAppointmentId)
        await PlanBookingService.countVisitAsStep(
          tx,
          plan,
          actor,
          plan.consultationAppointmentId
        );

      const reason = `Option ${plan.optionLabel ?? 'A'} was accepted`;
      const others = await tx
        .update(P)
        .set({ status: 'declined', endReason: reason, followUpDate: null })
        .where(
          and(
            eq(P.clinicId, clinicId),
            eq(P.proposalGroupId, plan.proposalGroupId),
            ne(P.id, plan.id),
            eq(P.status, 'proposed')
          )
        )
        .returning({ id: P.id });
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'status_change',
        fromValue: current.status,
        toValue: 'accepted',
        notes: body.notes ?? null,
        meta: null,
      });
      for (const other of others)
        await TreatmentHistoryService.record(tx, {
          clinicId,
          planId: other.id,
          actorId: actor.id,
          action: 'status_change',
          fromValue: 'proposed',
          toValue: 'declined',
          reason,
          meta: null,
        });
      return { plan, steps };
    });
    // An accept can take an advance; the money screens refresh either way.
    if (plan.status === 'accepted') signalPlanMoney(clinicId);
    return PlanQueryService.toDetail(plan, steps);
  }

  /** "Let me think": the plan stays suggested with the date to call back, logged as a call. */
  private static async think(
    clinicId: string,
    actor: Actor,
    planId: string,
    followUpDate: string,
    notes: string | undefined
  ): Promise<PlanDetail> {
    checkCallDate(followUpDate);
    const scope = await PlanQueryService.visible(clinicId, actor);
    const plan = await database.transaction(async (tx) => {
      const current = await this.lockAnswerable(tx, planId, scope);
      const [plan] = await tx
        .update(P)
        .set({ followUpDate })
        .where(eq(P.id, current.id))
        .returning();
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'follow_up_call',
        toValue: 'will_decide',
        notes: notes ?? null,
        meta: { nextFollowUpDate: followUpDate },
      });
      return plan;
    });
    return PlanQueryService.toDetail(plan);
  }

  /** "No": the plan closes as declined, optionally with a date to try again. */
  private static async decline(
    clinicId: string,
    actor: Actor,
    planId: string,
    reason: string | undefined,
    followUpDate: string | undefined
  ): Promise<PlanDetail> {
    if (followUpDate) checkCallDate(followUpDate);
    const scope = await PlanQueryService.visible(clinicId, actor);
    const plan = await database.transaction(async (tx) => {
      const current = await this.lockAnswerable(tx, planId, scope);
      const [plan] = await tx
        .update(P)
        .set({
          status: 'declined',
          endReason: reason ?? null,
          followUpDate: followUpDate ?? null,
        })
        .where(eq(P.id, current.id))
        .returning();
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'status_change',
        fromValue: 'proposed',
        toValue: 'declined',
        reason: reason ?? null,
        meta: null,
      });
      return plan;
    });
    return PlanQueryService.toDetail(plan);
  }

  /** One call with its outcome; a next date replaces the plan's follow-up date (3.2). */
  static async logCall(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanFollowUp
  ): Promise<PlanDetail> {
    if (body.nextFollowUpDate) checkCallDate(body.nextFollowUpDate);
    const scope = await PlanQueryService.visible(clinicId, actor);
    const plan = await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(P)
        .where(and(eq(P.id, planId), scope, inArray(P.status, [...CALLABLE])))
        .for('update');
      if (!current)
        throw new HttpError(
          409,
          "Calls can't be logged on a finished or stopped plan. Reload to see it."
        );
      const [plan] = body.nextFollowUpDate
        ? await tx
            .update(P)
            .set({ followUpDate: body.nextFollowUpDate })
            .where(eq(P.id, current.id))
            .returning()
        : [current];
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'follow_up_call',
        toValue: body.outcome,
        notes: body.notes ?? null,
        meta: body.nextFollowUpDate
          ? { nextFollowUpDate: body.nextFollowUpDate }
          : {},
      });
      return plan;
    });
    return PlanQueryService.toDetail(plan);
  }

  /** Closes one desk follow-up row (a step, call-back or check-up) without touching the plan itself. */
  static async dismissFollowUp(
    clinicId: string,
    actor: Actor,
    planId: string,
    kind: string,
    refId: string,
    reason: string
  ): Promise<void> {
    const scope = await PlanQueryService.visible(clinicId, actor);
    await database.transaction(async (tx) => {
      const [plan] = await tx
        .select({ id: P.id })
        .from(P)
        .where(and(eq(P.id, planId), scope));
      if (!plan) throw new HttpError(404, 'Follow-up not found');
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'follow_up_dismissed',
        reason,
        meta: { kind, refId },
      });
    });
  }

  /** The patient agreed to the changed plan: marks the waiting version approved (3.3). */
  static async approveChange(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<PlanDetail> {
    const scope = await PlanQueryService.visible(clinicId, actor);
    const plan = await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(P)
        .where(and(eq(P.id, planId), scope))
        .for('update');
      if (!current) throw new HttpError(404, 'Treatment plan not found');
      const [latest] = await tx
        .select()
        .from(Version)
        .where(eq(Version.planId, planId))
        .orderBy(desc(Version.version))
        .limit(1);
      if (!latest?.needsPatientApproval || latest.patientApprovedAt)
        throw new HttpError(
          409,
          "Nothing is waiting for the patient's approval. Reload to see the plan."
        );
      await tx
        .update(Version)
        .set({ patientApprovedAt: new Date() })
        .where(eq(Version.id, latest.id));
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'version_approved',
        meta: { version: latest.version },
      });
      return current;
    });
    return PlanQueryService.toDetail(plan);
  }

  /** The plan, locked; 404 when not visible, 409 when the patient has already answered. */
  private static async lockAnswerable(
    tx: Tx,
    planId: string,
    scope: Awaited<ReturnType<typeof PlanQueryService.visible>>,
    reopen = false
  ): Promise<TreatmentPlan> {
    const [row] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, planId), scope))
      .for('update');
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    // A patient who said no can say yes later, unless another option of theirs was taken.
    if (reopen && row.status === 'declined') {
      const [taken] = await tx
        .select({ id: P.id })
        .from(P)
        .where(
          and(
            eq(P.clinicId, row.clinicId),
            eq(P.proposalGroupId, row.proposalGroupId),
            ne(P.id, row.id),
            notInArray(P.status, ['proposed', 'declined'])
          )
        )
        .limit(1);
      if (taken)
        throw new HttpError(
          409,
          'Another option of this plan was already accepted. Reload to see it.'
        );
      return row;
    }
    if (row.status !== 'proposed')
      throw new HttpError(
        409,
        'The patient has already answered this plan. Reload to see it.'
      );
    return row;
  }
}

/** A call-back day: today or later (IST), and within a year. */
/** Deletes an uploaded file nothing will point to; a failed delete is logged, never thrown,
 *  so it can't hide the error the caller is already handling. */
async function discardUpload(key: string, planId: string): Promise<void> {
  try {
    await getFilePort().deleteDocument(key);
  } catch (err) {
    logger.warn('[TreatmentPlan] unused consent file not removed', {
      planId,
      key,
      message: (err as Error).message,
    });
  }
}

function checkCallDate(day: string): void {
  const today = getISTDateString();
  if (day < today) throw new HttpError(422, 'Pick today or a later date');
  if (day > addDays(today, 365))
    throw new HttpError(422, 'Pick a date within the next year');
}
