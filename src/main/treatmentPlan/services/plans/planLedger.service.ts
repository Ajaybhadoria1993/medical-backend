import { and, asc, eq, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { TreatmentPlanHistoryModel as History } from '../../models/treatmentPlanHistory.model';
import { TreatmentInstalmentModel as Instalment } from '../../models/treatmentLedger.model';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  type TreatmentPlan,
} from '../../models/treatmentPlan.model';
import {
  REFUND_REASONS,
  type PlanDiscount,
  type PlanPayment,
  type PlanRefund,
  type PlanWriteOff,
} from '../../schemas/plan.schema';
import type { PlanDetail } from '../../types/plan.types';
import type { Actor } from '../../types/template.types';
import {
  fromPaise,
  planBalance,
  stepChargePaise,
  toPaise,
} from '../../utils/money.utils';
import { TreatmentHistoryService } from '../history.service';
import { TreatmentPlanSettingsService } from '../settings.service';
import { PlanQueryService } from './planQuery.service';
import { PlanMoneyStore } from './planMoney.service';
import { signalPlanMoney } from '../../utils/moneySignal.utils';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Db = Tx | typeof database;

// Money moves once the patient has said yes, and after the plan ends (to settle up).
const MONEY_PLAN = [
  'accepted',
  'in_treatment',
  'paused',
  'completed',
  'ended_early',
];

/** A plan's money: charges as steps finish, payments with receipts, instalments, refunds,
 *  write-offs and later discounts, kept in the clinic ledger (PlanMoneyStore). */
export class PlanLedgerService {
  /** Ledger totals in paise, by entry type. */
  static sums(db: Db, planId: string): Promise<Record<string, number>> {
    return PlanMoneyStore.sums(db, planId);
  }

  /** What the step would be charged if finished now (paise); null once it is charged or skipped. */
  static async stepShare(
    db: Db,
    plan: TreatmentPlan,
    stepId: string
  ): Promise<number | null> {
    const [steps, entries] = await Promise.all([
      db.select().from(PlanStep).where(eq(PlanStep.planId, plan.id)),
      PlanMoneyStore.entries(db, plan.id),
    ]);
    const charged = new Set(
      entries.filter((e) => e.entryType === 'charge').map((e) => e.lineRef)
    );
    if (charged.has(stepId)) return null;
    const sums = await this.sums(db, plan.id);
    const fee = (s: (typeof steps)[number]) =>
      toPaise(s.fee) + toPaise(s.selectedOption?.extraFee ?? 0);
    const uncharged = steps.filter(
      (s) => !charged.has(s.id) && s.status !== 'skipped'
    );
    const step = uncharged.find((s) => s.id === stepId);
    if (!step) return null;
    return stepChargePaise({
      totalPaise: toPaise(plan.totalAmount),
      chargedPaise: sums.charge ?? 0,
      feePaise: fee(step),
      unchargedFeesPaise: uncharged.reduce((n, s) => n + fee(s), 0),
      unchargedCount: uncharged.length,
    });
  }

  /** Shares (paise) of this step and of every earlier step not charged yet, so booking can collect them together;
   *  null once this step is charged or skipped. Same rule as stepShare, one read. */
  static async sharesUpTo(
    db: Db,
    plan: TreatmentPlan,
    stepId: string
  ): Promise<{
    thisPaise: number;
    earlier: { seq: number; paise: number }[];
  } | null> {
    const [steps, entries, sums] = await Promise.all([
      db.select().from(PlanStep).where(eq(PlanStep.planId, plan.id)),
      PlanMoneyStore.entries(db, plan.id),
      this.sums(db, plan.id),
    ]);
    const charged = new Set(
      entries.filter((e) => e.entryType === 'charge').map((e) => e.lineRef)
    );
    const fee = (s: (typeof steps)[number]) =>
      toPaise(s.fee) + toPaise(s.selectedOption?.extraFee ?? 0);
    const uncharged = steps.filter(
      (s) => !charged.has(s.id) && s.status !== 'skipped'
    );
    const target = uncharged.find((s) => s.id === stepId);
    if (!target) return null;
    const share = (s: (typeof steps)[number]) =>
      stepChargePaise({
        totalPaise: toPaise(plan.totalAmount),
        chargedPaise: sums.charge ?? 0,
        feePaise: fee(s),
        unchargedFeesPaise: uncharged.reduce((n, x) => n + fee(x), 0),
        unchargedCount: uncharged.length,
      });
    return {
      thisPaise: share(target),
      earlier: uncharged
        .filter((s) => s.seq < target.seq)
        .sort((a, b) => a.seq - b.seq)
        .map((s) => ({ seq: s.seq, paise: share(s) })),
    };
  }

  /** What this step costs in paise: its charge once done, else its share now (a package step's fee is 0, the share isn't). */
  static async stepPrice(
    db: Db,
    plan: TreatmentPlan,
    stepId: string
  ): Promise<number | null> {
    const charge = (await PlanMoneyStore.entries(db, plan.id)).find(
      (e) => e.entryType === 'charge' && e.lineRef === stepId
    );
    return charge ? charge.amountPaise : this.stepShare(db, plan, stepId);
  }

  /** The step just finished is charged its share of what is left of the agreed total (Q18).
   *  Called inside the "visit completed" transaction; keyed by the step, so it is charged once. */
  static async chargeStep(
    tx: Tx,
    plan: TreatmentPlan,
    stepId: string
  ): Promise<void> {
    const amount = await this.stepShare(tx, plan, stepId);
    if (amount === null || amount <= 0) return;
    await PlanMoneyStore.record(tx, plan, {
      entryType: 'charge',
      amountPaise: amount,
      stepId,
      requestId: `tpl:${plan.id}:charge:${stepId}`,
      // A charge is the system's, on the visit; the plan's doctor stands as its author.
      createdBy: plan.doctorId,
    });
  }

  /** Money taken at the desk on the visit that did this step; capped at the step's charge, recorded once. */
  static async settleFromVisit(
    tx: Tx,
    plan: TreatmentPlan,
    stepId: string,
    receivedPaise: number
  ): Promise<void> {
    if (receivedPaise <= 0) return;
    const all = await PlanMoneyStore.entries(tx, plan.id);
    const rows = all.filter((e) => e.lineRef === stepId);
    const visitRows = rows.filter((r) => r.entryType === 'paid_at_visit');
    // One live visit payment per step; a released one (its visit cancelled) lets a new visit settle it.
    if (visitRows.some((r) => !all.some((a) => a.reversesEntryId === r.id)))
      return;
    const charge = rows.find((r) => r.entryType === 'charge');
    // This visit IS the step, so its desk payment counts for it even if an advance already covers
    // today's due; capped by what is left on the whole plan, so the plan is never overpaid.
    const { leftToPay } = planBalance(
      toPaise(plan.totalAmount),
      await this.sums(tx, plan.id)
    );
    // Before completion there is no charge yet, so the step's share is the cap.
    const cap =
      charge?.amountPaise ?? (await this.stepShare(tx, plan, stepId)) ?? 0;
    const amount = Math.min(receivedPaise, cap, Math.max(0, leftToPay));
    if (amount <= 0) return;
    await PlanMoneyStore.record(tx, plan, {
      entryType: 'paid_at_visit',
      amountPaise: amount,
      stepId,
      reason: 'Paid at the visit',
      requestId: `tpl:${plan.id}:visit:${stepId}:${visitRows.length}`,
      createdBy: plan.doctorId,
    });
    await this.settleInstalments(tx, plan.id);
  }

  /** The step's visit was cancelled, missed or unlinked before the step was done: its desk payment
   *  goes back to the visit (the desk refunds or keeps it there), so the plan no longer counts it. */
  static async releaseVisitPayment(
    tx: Tx,
    plan: TreatmentPlan,
    stepId: string,
    actorId: string | null
  ): Promise<void> {
    const all = await PlanMoneyStore.entries(tx, plan.id);
    const live = all.find(
      (e) =>
        e.entryType === 'paid_at_visit' &&
        e.lineRef === stepId &&
        !all.some((a) => a.reversesEntryId === e.id)
    );
    if (!live) return;
    await PlanMoneyStore.record(tx, plan, {
      entryType: 'adjustment',
      amountPaise: live.amountPaise,
      stepId,
      reversesEntryId: live.id,
      reason: 'Visit cancelled before the step was done',
      requestId: `tpl:${plan.id}:unvisit:${live.id}`,
      createdBy: actorId ?? plan.doctorId,
    });
    await this.settleInstalments(tx, plan.id);
  }

  /** Reception takes money: a receipt, and the oldest unpaid instalments marked paid (5.2, 5.3). */
  static async collect(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanPayment
  ): Promise<PlanDetail> {
    if (await this.isRepeat(clinicId, body.requestId))
      return PlanQueryService.get(clinicId, actor, planId);
    await database.transaction(async (tx) => {
      const plan = await this.lockPlan(tx, clinicId, actor, planId);
      // Paying ahead for later visits is fine; paying more than the whole plan is not.
      const { leftToPay } = planBalance(
        toPaise(plan.totalAmount),
        await this.sums(tx, planId)
      );
      if (toPaise(body.amount) > leftToPay)
        throw new HttpError(
          422,
          leftToPay
            ? `The most that can be paid on this plan is ${fromPaise(leftToPay)}`
            : 'Nothing is left to pay on this plan'
        );
      const entry = await PlanMoneyStore.record(tx, plan, {
        entryType: 'payment',
        amountPaise: toPaise(body.amount),
        paymentMode: body.paymentMode,
        reason: body.notes ?? null,
        requestId: body.requestId,
        createdBy: actor.id,
      });
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'payment',
        notes: body.notes ?? null,
        meta: { ledgerEntryId: entry.id, amount: fromPaise(entry.amountPaise) },
      });
      await this.settleInstalments(tx, plan.id);
    });
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Money back to the patient, never more than they have paid (5.4). */
  static async refund(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanRefund
  ): Promise<PlanDetail> {
    if (await this.isRepeat(clinicId, body.requestId))
      return PlanQueryService.get(clinicId, actor, planId);
    await database.transaction(async (tx) => {
      const plan = await this.lockPlan(tx, clinicId, actor, planId);
      const balance = planBalance(
        toPaise(plan.totalAmount),
        await this.sums(tx, planId)
      );
      const amount = toPaise(body.amount);
      const entries = await PlanMoneyStore.entries(tx, planId);
      const source = entries.find(
        (e) =>
          e.id === body.paymentEntryId &&
          (e.entryType === 'payment' || e.entryType === 'advance')
      );
      if (!source)
        throw new HttpError(422, 'Pick a payment of this plan to refund');
      const leftOnReceipt =
        source.amountPaise -
        entries
          .filter(
            (e) => e.entryType === 'refund' && e.reversesEntryId === source.id
          )
          .reduce((n, e) => n + e.amountPaise, 0);
      if (amount > leftOnReceipt)
        throw new HttpError(
          422,
          `This receipt has ${fromPaise(Math.max(0, leftOnReceipt))} left to refund`
        );
      // Unused advance: paid but not yet used by completed visits. Past it, money for work already done goes back.
      const unused = Math.max(0, -balance.due);
      if (amount > unused) {
        if (body.reasonCode !== 'completed_visits')
          throw new HttpError(
            422,
            `Only ${fromPaise(unused)} is unused advance. To refund more, choose "Refund for completed visits".`
          );
        if (!actor.isDoctor && actor.userType !== 'Admin')
          throw new HttpError(
            403,
            'Only the doctor or an admin can refund money for completed visits'
          );
      }
      if (amount > balance.paid)
        throw new HttpError(
          422,
          `A refund can't be more than what was paid (${fromPaise(balance.paid)})`
        );
      const reason = [REFUND_REASONS[body.reasonCode], body.note]
        .filter(Boolean)
        .join(' · ');
      const entry = await PlanMoneyStore.record(tx, plan, {
        entryType: 'refund',
        amountPaise: amount,
        paymentMode: body.paymentMode,
        reason,
        reversesEntryId: source.id,
        requestId: body.requestId,
        createdBy: actor.id,
      });
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'refund',
        reason,
        meta: {
          ledgerEntryId: entry.id,
          amount: fromPaise(entry.amountPaise),
          paymentEntryId: source.id,
        },
      });
      await this.settleInstalments(tx, plan.id);
    });
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Forgives part or all of what is owed now (Doctor or Admin, with a reason; 5.4). */
  static async writeOff(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanWriteOff
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    if (await this.isRepeat(clinicId, body.requestId))
      return PlanQueryService.get(clinicId, actor, planId);
    await database.transaction(async (tx) => {
      const plan = await this.lockPlan(tx, clinicId, actor, planId);
      const balance = planBalance(
        toPaise(plan.totalAmount),
        await this.sums(tx, planId)
      );
      if (toPaise(body.amount) > balance.due)
        throw new HttpError(
          422,
          `Only what is owed now can be written off (${fromPaise(Math.max(0, balance.due))})`
        );
      const entry = await PlanMoneyStore.record(tx, plan, {
        entryType: 'write_off',
        amountPaise: toPaise(body.amount),
        reason: body.reason,
        approvedBy: actor.id,
        requestId: body.requestId,
        createdBy: actor.id,
      });
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'write_off',
        reason: body.reason,
        meta: { ledgerEntryId: entry.id, amount: fromPaise(entry.amountPaise) },
      });
    });
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Lowers what is still to come after acceptance (Doctor or Admin, with a reason). It only helps
   *  the patient, so no re-approval; unpaid instalments shrink from the last one back. */
  static async discount(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanDiscount
  ): Promise<PlanDetail> {
    this.requireApprover(actor);
    const settings = await TreatmentPlanSettingsService.get(clinicId);
    await database.transaction(async (tx) => {
      const plan = await this.lockPlan(tx, clinicId, actor, planId);
      // A discount writes no ledger row, so its retry id is kept in its history row; the plan lock serialises repeats.
      if (body.requestId) {
        const [seen] = await tx
          .select({ id: History.id })
          .from(History)
          .where(
            and(
              eq(History.planId, planId),
              eq(History.action, 'discount_approved'),
              sql`${History.meta}->>'requestId' = ${body.requestId}`
            )
          )
          .limit(1);
        if (seen) return;
      }
      const amount = toPaise(body.amount);
      const balance = planBalance(
        toPaise(plan.totalAmount),
        await this.sums(tx, planId)
      );
      // Never more than is still unpaid: a discount on money already paid would need a refund instead.
      const maxDiscount = Math.min(balance.toCome, balance.leftToPay);
      if (maxDiscount <= 0)
        throw new HttpError(
          422,
          'This plan is fully paid, so there is nothing left to discount'
        );
      if (amount > maxDiscount)
        throw new HttpError(
          422,
          `A discount can only lower what is still to pay (${fromPaise(maxDiscount)})`
        );
      const discountAmount = fromPaise(toPaise(plan.discountAmount) + amount);
      await tx
        .update(P)
        .set({
          totalAmount: fromPaise(toPaise(plan.totalAmount) - amount),
          discountAmount,
        })
        .where(eq(P.id, planId));
      await this.shrinkInstalments(tx, planId, amount);
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'discount_approved',
        reason: body.reason,
        meta: {
          discountAmount,
          capPercent: settings.discountCapPercent,
          ...(body.requestId ? { requestId: body.requestId } : {}),
        },
      });
    });
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Instalments chosen on accept: they must add up to the total less the advance (5.3). */
  static async createInstalments(
    tx: Tx,
    plan: TreatmentPlan,
    instalments: { amount: string; dueDate: string }[]
  ): Promise<void> {
    const owed = toPaise(plan.totalAmount) - toPaise(plan.advanceAmount);
    const sum = instalments.reduce((n, i) => n + toPaise(i.amount), 0);
    if (sum !== owed)
      throw new HttpError(
        422,
        `The instalments must add up to ${fromPaise(owed)} (the total less the advance); they add up to ${fromPaise(sum)}`
      );
    const days = instalments.map((i) => i.dueDate);
    if (days.some((d, i) => i > 0 && d < days[i - 1]))
      throw new HttpError(422, 'Put the instalments in date order');
    await tx.insert(Instalment).values(
      instalments.map((i, n) => ({
        clinicId: plan.clinicId,
        planId: plan.id,
        seq: n + 1,
        amount: fromPaise(toPaise(i.amount)),
        dueDate: i.dueDate,
      }))
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Payments and desk payments counted for a step (less refunds) cover instalments in order.
   *  The advance is already off their total, so it is not counted again here. */
  private static async settleInstalments(tx: Tx, planId: string) {
    const [rows, sums] = await Promise.all([
      tx
        .select()
        .from(Instalment)
        .where(eq(Instalment.planId, planId))
        .orderBy(asc(Instalment.seq)),
      this.sums(tx, planId),
    ]);
    let covered =
      (sums.payment ?? 0) + (sums.paid_at_visit ?? 0) - (sums.refund ?? 0);
    for (const row of rows) {
      covered -= toPaise(row.amount);
      const paid = covered >= 0;
      if (paid !== !!row.paidAt)
        await tx
          .update(Instalment)
          .set({ paidAt: paid ? new Date() : null })
          .where(eq(Instalment.id, row.id));
    }
  }

  /** Takes a discount off the unpaid instalments, last first; one brought to zero is removed. */
  private static async shrinkInstalments(
    tx: Tx,
    planId: string,
    paise: number
  ) {
    const unpaid = (
      await tx
        .select()
        .from(Instalment)
        .where(eq(Instalment.planId, planId))
        .orderBy(asc(Instalment.seq))
    )
      .filter((r) => !r.paidAt)
      .reverse();
    let left = paise;
    for (const row of unpaid) {
      if (left <= 0) break;
      const take = Math.min(left, toPaise(row.amount));
      left -= take;
      if (take === toPaise(row.amount))
        await tx.delete(Instalment).where(eq(Instalment.id, row.id));
      else
        await tx
          .update(Instalment)
          .set({ amount: fromPaise(toPaise(row.amount) - take) })
          .where(eq(Instalment.id, row.id));
    }
  }

  private static requireApprover(actor: Actor) {
    if (!actor.isDoctor && actor.userType !== 'Admin')
      throw new HttpError(403, 'Only a doctor or an admin can do this');
  }

  /** A retried money action (same requestId) gets the first result, never a second entry (Q17). */
  private static async isRepeat(clinicId: string, requestId: string) {
    return !!(await PlanMoneyStore.repeat(database, clinicId, requestId));
  }

  private static async lockPlan(
    tx: Tx,
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<TreatmentPlan> {
    const scope = await PlanQueryService.visible(clinicId, actor);
    const [plan] = await tx
      .select()
      .from(P)
      .where(and(eq(P.id, planId), scope))
      .for('update');
    if (!plan) throw new HttpError(404, 'Treatment plan not found');
    if (!MONEY_PLAN.includes(plan.status))
      throw new HttpError(
        409,
        'Money is recorded once the patient has accepted the plan'
      );
    return plan;
  }
}
