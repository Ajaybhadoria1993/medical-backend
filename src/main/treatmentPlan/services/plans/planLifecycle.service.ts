import { and, eq } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { getISTDateString } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import { getAppointmentPort } from '../../ports';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  TreatmentStepAppointmentModel as Link,
  type TreatmentPlan,
} from '../../models/treatmentPlan.model';
import type {
  PlanEnd,
  PlanExtend,
  PlanNote,
  PlanPause,
  PlanRecall,
} from '../../schemas/plan.schema';
import type { PlanDetail } from '../../types/plan.types';
import type { Actor } from '../../types/template.types';
import { fromPaise, toPaise } from '../../utils/money.utils';
import { TreatmentHistoryService } from '../history.service';
import { PlanQueryService } from './planQuery.service';
import { PlanBookingService } from './planBooking.service';
import { PlanMoneyStore } from './planMoney.service';
import { signalPlanMoney } from '../../utils/moneySignal.utils';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Status = TreatmentPlan['status'];

const STATUS_WORD: Record<Status, string> = {
  proposed: 'suggested',
  accepted: 'accepted',
  in_treatment: 'in treatment',
  completed: 'completed',
  declined: 'declined',
  paused: 'paused',
  ended_early: 'ended',
};

/** Pause, resume, end early, recall, package extension and notes (DEV_PLAN §6.1, Phase 6). */
export class PlanLifecycleService {
  /** Stops booking for a while; booked visits stay for staff to keep or cancel (§6.1). */
  static async pause(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanPause
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    await database.transaction(async (tx) => {
      const plan = await this.lock(tx, clinicId, actor, planId, 'paused', [
        'accepted',
        'in_treatment',
      ]);
      await this.setStatus(tx, plan, actor, 'paused', body.reason);
    });
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Back to where it was: in treatment once a step is done, else accepted. Earliest days are
   *  worked out on read, and booking never goes before today, so nothing is re-dated here. */
  static async resume(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    await database.transaction(async (tx) => {
      const plan = await this.lock(tx, clinicId, actor, planId, 'resumed', [
        'paused',
      ]);
      const [done] = await tx
        .select({ id: PlanStep.id })
        .from(PlanStep)
        .where(and(eq(PlanStep.planId, plan.id), eq(PlanStep.status, 'done')))
        .limit(1);
      await this.setStatus(
        tx,
        plan,
        actor,
        done ? 'in_treatment' : 'accepted',
        null
      );
    });
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Ends the plan with a reason. Unused steps are never charged; credit goes back through a refund.
   *  `sensitive` silences every message for the plan, its visits' reminders included (6.4). */
  static async end(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanEnd
  ): Promise<PlanDetail & { visitsNotCancelled: number }> {
    this.requireApprover(actor);
    const toCancel = await database.transaction(async (tx) => {
      // A suggested plan is declined, not ended: nothing was agreed or paid yet.
      const plan = await this.lock(tx, clinicId, actor, planId, 'ended', [
        'accepted',
        'in_treatment',
        'paused',
      ]);
      await tx
        .update(P)
        .set({
          status: 'ended_early',
          endReason: body.reason,
          endReasonSensitive: body.sensitive,
          followUpDate: null,
        })
        .where(eq(P.id, plan.id));
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'ended_early',
        fromValue: plan.status,
        toValue: 'ended_early',
        reason: body.reason,
        meta: { sensitive: body.sensitive },
      });
      return PlanBookingService.releaseOnEnd(tx, plan, actor);
    });
    // Cancelling is the appointments module's own write, so it runs after commit; a failed one never undoes the end.
    let visitsNotCancelled = 0;
    for (const appointmentId of toCancel) {
      try {
        await getAppointmentPort().cancelPlanVisit(
          clinicId,
          appointmentId,
          actor.id,
          actor.userType
        );
      } catch (err) {
        visitsNotCancelled++;
        logger.error('[TreatmentPlan] visit not cancelled on plan end', {
          planId,
          appointmentId,
          message: (err as Error).message,
        });
      }
    }
    return {
      ...(await PlanQueryService.get(clinicId, actor, planId)),
      visitsNotCancelled,
    };
  }

  /** When to call the patient back after a finished plan; null clears it. */
  static async setRecall(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanRecall
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    if (body.recallDate && body.recallDate <= getISTDateString())
      throw new HttpError(422, 'Pick a recall date after today');
    await database.transaction(async (tx) => {
      const plan = await this.lock(
        tx,
        clinicId,
        actor,
        planId,
        'given a recall date',
        ['completed']
      );
      await tx
        .update(P)
        .set({ recallDate: body.recallDate })
        .where(eq(P.id, plan.id));
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'recall_set',
        fromValue: plan.recallDate,
        toValue: body.recallDate,
        meta: { recallDate: body.recallDate },
      });
    });
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** A package gets a new last day; an optional fee raises the total and is charged at once (§6.1).
   *  ponytail: the fee is not re-spread over instalments; it shows as due now until paid. */
  static async extend(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanExtend
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    if (await PlanMoneyStore.repeat(database, clinicId, body.requestId))
      return PlanQueryService.get(clinicId, actor, planId);
    await database.transaction(async (tx) => {
      const plan = await this.lock(tx, clinicId, actor, planId, 'extended', [
        'accepted',
        'in_treatment',
        'paused',
      ]);
      if (plan.planType !== 'package' || !plan.packageExpiresOn)
        throw new HttpError(
          409,
          'Only a package with a last day can be extended'
        );
      if (body.expiresOn <= plan.packageExpiresOn)
        throw new HttpError(
          422,
          `Pick a day after the current last day (${plan.packageExpiresOn})`
        );
      const fee = body.fee ? toPaise(body.fee) : 0;
      await tx
        .update(P)
        .set({
          packageExpiresOn: body.expiresOn,
          ...(fee
            ? { totalAmount: fromPaise(toPaise(plan.totalAmount) + fee) }
            : {}),
        })
        .where(eq(P.id, plan.id));
      const entry = fee
        ? await PlanMoneyStore.record(tx, plan, {
            entryType: 'charge',
            amountPaise: fee,
            reason: 'Package extension',
            requestId: body.requestId,
            createdBy: actor.id,
          })
        : null;
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'package_extended',
        fromValue: plan.packageExpiresOn,
        toValue: body.expiresOn,
        reason: body.reason,
        meta: entry
          ? {
              extensionFee: fromPaise(entry.amountPaise),
              ledgerEntryId: entry.id,
            }
          : {},
      });
    });
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Any staff member who can see the plan can leave a note on it, at any stage. */
  static async addNote(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanNote
  ): Promise<PlanDetail> {
    const plan = await PlanQueryService.get(clinicId, actor, planId);
    await database.transaction((tx) =>
      TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'note',
        notes: body.note,
        meta: null,
      })
    );
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** True when the visit serves a plan ended for a sensitive reason: no reminder goes out (6.4). */
  static async isSilencedVisit(appointmentId: string): Promise<boolean> {
    const [row] = await database
      .select({ id: P.id })
      .from(Link)
      .innerJoin(P, eq(P.id, Link.planId))
      .where(
        and(
          eq(Link.appointmentId, appointmentId),
          eq(P.endReasonSensitive, true)
        )
      )
      .limit(1);
    return !!row;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private static async setStatus(
    tx: Tx,
    plan: TreatmentPlan,
    actor: Actor,
    status: Status,
    reason: string | null
  ) {
    await tx.update(P).set({ status }).where(eq(P.id, plan.id));
    await TreatmentHistoryService.record(tx, {
      clinicId: plan.clinicId,
      planId: plan.id,
      actorId: actor.id,
      action: 'status_change',
      fromValue: plan.status,
      toValue: status,
      reason,
      meta: null,
    });
  }

  private static requireApprover(actor: Actor) {
    if (!actor.isDoctor && actor.userType !== 'Admin')
      throw new HttpError(403, 'Only a doctor or an admin can do this');
  }

  /** The plan, locked, in one of the statuses the action allows (§6.1); else 409 in plain words. */
  private static async lock(
    tx: Tx,
    clinicId: string,
    actor: Actor,
    planId: string,
    action: string,
    from: Status[]
  ): Promise<TreatmentPlan> {
    const scope = await PlanQueryService.visible(clinicId, actor);
    const [plan] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, planId), scope))
      .for('update');
    if (!plan) throw new HttpError(404, 'Treatment plan not found');
    if (!from.includes(plan.status))
      throw new HttpError(
        409,
        `This plan can't be ${action} while it is ${STATUS_WORD[plan.status]}`
      );
    return plan;
  }
}
