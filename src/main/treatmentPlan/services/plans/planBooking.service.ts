import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { getISTDateString } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  TreatmentStepAppointmentModel as Link,
  type TreatmentPlan,
  type TreatmentPlanStep,
} from '../../models/treatmentPlan.model';
import { getAppointmentPort, type PlanAppointment } from '../../ports';
import type {
  BookAll,
  BookStep,
  LinkStep,
  MarkStepDone,
} from '../../schemas/plan.schema';
import type { AppointmentChangedEvent } from '../../types/appointmentSync.types';
import type {
  BookAllPick,
  ReleasedStep,
  PlanDetail,
  VisitStep,
} from '../../types/plan.types';
import type { Actor } from '../../types/template.types';
import {
  collectNow,
  fromPaise,
  planBalance,
  toPaise,
} from '../../utils/money.utils';
import {
  addDays,
  earliestDates,
  lateAfterDates,
} from '../../utils/timing.utils';
import { TreatmentHistoryService } from '../history.service';
import { PlanLedgerService } from './planLedger.service';
import { planDuePaise, planLeftToPayPaise } from './planMoney.service';
import { PlanQueryService } from './planQuery.service';
import {
  signalPlanChange,
  signalPlanMoney,
} from '../../utils/moneySignal.utils';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Db = Tx | typeof database;

// Steps are booked only once the patient has said yes, and until the plan closes.
const BOOKABLE_PLAN = ['accepted', 'in_treatment'] as const;
const BOOKABLE_STEP = ['pending', 'missed'] as const;
// Once the patient is in (or done), the visit belongs to the step for good.
const STARTED_VISIT = ['Patient Arrived', 'Completed'];
// Visits that never happened can't count as a step.
const DEAD_VISIT = ['Cancelled', 'NoShow', 'Missed', 'Rescheduled'];
// "Book all" looks this far ahead for each step's first free day.
const SEARCH_DAYS = 60;

/** Booking, linking and finishing plan steps, and keeping dates right when a visit changes (DEV_PLAN Phase 4). */
/** Plans whose visits are paid one by one, on the day. */
const PER_VISIT = ['per_visit', 'advance_per_visit'];

export class PlanBookingService {
  /** The step's earliest day and the doctor's free times (or token sessions) on `date` (4.1). */
  static async bookingOptions(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    date: string
  ) {
    const { plan, step, earliest, lateAfter } = await this.loadStep(
      clinicId,
      actor,
      planId,
      stepId
    );
    const [day, existingVisit, shares, sums] = await Promise.all([
      getAppointmentPort().bookingOptions(clinicId, plan.doctorId, date),
      this.usableVisitOn(clinicId, actor, plan, step.seq, date),
      PlanLedgerService.sharesUpTo(database, plan, step.id),
      PlanLedgerService.sums(database, plan.id),
    ]);
    // What booking this step may collect: it, plus earlier steps not paid yet (booked, not done); same rule as the plan.
    const earlierPaise = (shares?.earlier ?? []).reduce(
      (n, s) => n + s.paise,
      0
    );
    const balance = planBalance(toPaise(plan.totalAmount), sums);
    const c = shares
      ? collectNow(balance, shares.thisPaise + earlierPaise)
      : null;
    // The "this step only" choice, same rule without the earlier steps.
    const only = shares ? collectNow(balance, shares.thisPaise) : null;
    const collect = c && {
      amount: fromPaise(shares!.thisPaise),
      earlier: fromPaise(earlierPaise),
      earlierSteps: shares!.earlier.map((s) => s.seq),
      priorDue: fromPaise(c.priorDuePaise),
      fromAdvance: fromPaise(c.fromAdvancePaise),
      toCollect: fromPaise(c.toCollectPaise),
      toCollectThisOnly: fromPaise(only!.toCollectPaise),
    };
    // A visit that holds the day but can't serve this step (done, or another step's): booking is refused.
    const blockingVisit = existingVisit
      ? null
      : await this.blockingVisitOn(clinicId, plan, date);
    // Nothing free and no visit to use: the next day that has a free time, so staff jump to it.
    const nextFreeDate =
      (!day.options.length && !existingVisit) || blockingVisit
        ? await this.nextFreeDay(clinicId, plan.doctorId, date)
        : null;
    return {
      earliestDate: earliest,
      /** Last on-time day; a later pick is allowed but marked late. Null = no limit. */
      lateAfterDate: lateAfter,
      ...day,
      // No times for a day that can't be booked, so none can be picked.
      options: blockingVisit ? [] : day.options,
      existingVisit,
      blockingVisit,
      nextFreeDate,
      collect,
    };
  }

  /** The patient's visit with this doctor on `date` that a new booking would clash with, and the step of
   *  this plan it serves (if any); null when the day is free. Same statuses the booking refuses on. */
  private static async blockingVisitOn(
    clinicId: string,
    plan: TreatmentPlan,
    date: string
  ) {
    const visit = await getAppointmentPort().todayForPatient(
      clinicId,
      plan.patientId,
      plan.doctorId,
      date
    );
    if (!visit) return null;
    const [usedBy] = await database
      .select({ seq: PlanStep.seq, name: PlanStep.name })
      .from(Link)
      .innerJoin(PlanStep, eq(PlanStep.id, Link.stepId))
      .where(
        and(
          eq(Link.appointmentId, visit.id),
          eq(Link.planId, plan.id),
          isNull(Link.unlinkedAt)
        )
      )
      .limit(1);
    return { ...visit, usedBy: usedBy ?? null };
  }

  /** First day after `from` (within 14) the doctor has a free time or token; null when none. */
  private static async nextFreeDay(
    clinicId: string,
    doctorId: string,
    from: string
  ): Promise<string | null> {
    // ponytail: one day at a time, at most 14 reads; a range read in the appointments port if it gets slow.
    for (let i = 1; i <= 14; i++) {
      const d = addDays(from, i);
      const day = await getAppointmentPort().bookingOptions(
        clinicId,
        doctorId,
        d
      );
      if (day.options.length) return d;
    }
    return null;
  }

  /** The patient's visit with this doctor on `date` that the step can use instead of a second booking
   *  (the booking would be refused: one visit per patient per day); null when none. */
  private static async usableVisitOn(
    clinicId: string,
    actor: Actor,
    plan: TreatmentPlan,
    seq: number,
    date: string
  ): Promise<PlanAppointment | null> {
    const upcoming = (await this.linkable(clinicId, actor, plan.id)).find(
      (a) => a.date === date
    );
    if (upcoming) return upcoming;
    // Step 1 may also use today's visit even once it has started (as link() allows).
    if (seq !== 1 || date !== getISTDateString()) return null;
    const today = await getAppointmentPort().todayForPatient(
      clinicId,
      plan.patientId,
      plan.doctorId,
      date
    );
    return today ? this.todayVisit(clinicId, plan, today.id) : null;
  }

  /** The plan doctor's free times (or token sessions) on one day, whichever step it is for: "Book all"
   *  lets staff move a later visit before the earlier ones are booked (4.3). */
  static async dayOptions(
    clinicId: string,
    actor: Actor,
    planId: string,
    date: string
  ) {
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    return getAppointmentPort().bookingOptions(clinicId, plan.doctorId, date);
  }

  /** Books one step through the appointments module and links it (4.2). */
  static async book(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    body: BookStep
  ): Promise<PlanDetail> {
    await this.bookOne(clinicId, actor, planId, stepId, body);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  private static async bookOne(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    body: BookStep
  ): Promise<void> {
    const { plan, step, earliest } = await this.loadStep(
      clinicId,
      actor,
      planId,
      stepId
    );
    this.checkDate(actor, plan, step, earliest, body.date, body.overrideReason);
    // ponytail: the visit commits in the appointments module before the link; two people booking
    // the same step at once can leave one extra visit (the second link is refused with 409).
    const visit = await getAppointmentPort().bookTreatmentVisit(
      clinicId,
      actor.id,
      {
        patientId: plan.patientId,
        doctorId: plan.doctorId,
        date: body.date,
        time: body.time ?? null,
        sessionIndex: body.sessionIndex ?? null,
        tokenNo: body.tokenNo ?? null,
        notes: `Treatment plan: ${plan.title}, step ${step.seq} (${step.name})`,
      }
    );
    await database.transaction((tx) =>
      this.attach(tx, plan, step, visit, actor, earliest, body.overrideReason)
    );
  }

  /** First free visit for every step not yet booked, each counted from the one before (4.3). */
  static async bookAllPreview(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<BookAllPick[]> {
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    const { steps, bookedOn } = await this.timeline(database, plan);
    const today = getISTDateString();
    const port = getAppointmentPort();
    const picks: BookAllPick[] = [];
    let anchor = plan.acceptedAt ? getISTDateString(plan.acceptedAt) : today;
    // The patient's own visits with this doctor: a step on that day reuses it (one visit per patient per day).
    const existing = await this.linkableFor(clinicId, plan);
    // Read only when step 1 lands on today, the one case today's visit can be used.
    const todayUsable = async () => {
      const own = await port.todayForPatient(
        clinicId,
        plan.patientId,
        plan.doctorId,
        today
      );
      return own ? this.todayVisit(clinicId, plan, own.id) : null;
    };
    for (const step of steps) {
      if (step.status === 'done' || step.status === 'skipped') {
        anchor = step.doneAt ? getISTDateString(step.doneAt) : anchor;
        continue;
      }
      const booked = bookedOn.get(step.id);
      if (booked) {
        anchor = booked;
        continue;
      }
      // Same as earliestDates: step 1 never waits.
      let day = addDays(anchor, step.seq === 1 ? 0 : step.gapDays);
      if (day < today) day = today;
      const earliestDate = day;
      let pick: BookAllPick | null = null;
      for (let i = 0; i < SEARCH_DAYS && !pick; i++, day = addDays(day, 1)) {
        const own =
          existing.find(
            (a) =>
              a.date === day && !picks.some((p) => p.appointmentId === a.id)
          ) ?? (step.seq === 1 && day === today ? await todayUsable() : null);
        if (own) {
          pick = {
            stepId: step.id,
            seq: step.seq,
            name: step.name,
            gapDays: step.gapDays,
            earliestDate,
            date: day,
            time: own.time,
            sessionIndex: null,
            tokenNo: own.tokenNo,
            label: `Existing visit · ${own.tokenNo ? `token ${own.tokenNo}` : (own.time ?? '')}`,
            appointmentId: own.id,
          };
          break;
        }
        // One visit per patient per doctor per day: a day already picked above, or with a visit we can't reuse, is taken.
        if (
          picks.some((p) => p.date === day) ||
          (await port.todayForPatient(
            clinicId,
            plan.patientId,
            plan.doctorId,
            day
          ))
        )
          continue;
        const { options } = await port.bookingOptions(
          clinicId,
          plan.doctorId,
          day
        );
        if (options[0])
          pick = {
            stepId: step.id,
            seq: step.seq,
            name: step.name,
            gapDays: step.gapDays,
            earliestDate,
            date: day,
            time: options[0].time,
            sessionIndex: options[0].sessionIndex,
            tokenNo: options[0].tokenNo,
            label: options[0].label,
            appointmentId: null,
          };
      }
      if (!pick)
        throw new HttpError(
          422,
          `No free visit in the next ${SEARCH_DAYS} days for step ${step.seq}. Book it by hand.`
        );
      picks.push(pick);
      anchor = pick.date;
    }
    return picks;
  }

  /** Books the confirmed picks in order; each step's earliest day follows the booking before it. */
  static async bookAll(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: BookAll
  ): Promise<PlanDetail> {
    // In order: each booking becomes the next step's anchor. A failure stops here; earlier ones stay.
    let booked = 0;
    for (const pick of body.picks) {
      try {
        // A pick on the patient's own visit links it; the rest are new bookings.
        if (pick.appointmentId)
          await this.linkOne(clinicId, actor, planId, pick.stepId, {
            appointmentId: pick.appointmentId,
          });
        else {
          const { appointmentId: _, ...visit } = pick;
          await this.bookOne(clinicId, actor, planId, pick.stepId, visit);
        }
        booked++;
      } catch (err) {
        // Name the step and what already went through, so staff know exactly what to fix.
        const reason =
          err instanceof HttpError ? err.message : 'Something went wrong';
        const done = booked
          ? `${booked} ${booked === 1 ? 'visit was' : 'visits were'} booked before it.`
          : 'Nothing was booked.';
        throw new HttpError(
          err instanceof HttpError ? err.status : 500,
          `Couldn't book the visit on ${new Date(`${pick.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${reason.replace(/\.$/, '')}. ${done} Book the rest from the plan.`
        );
      }
    }
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** The patient's open visits with the plan's doctor that no step uses yet (4.4). */
  static async linkable(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<PlanAppointment[]> {
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    return this.linkableFor(clinicId, plan);
  }

  /** linkable() for a plan already loaded, so callers holding it skip a second read. */
  private static async linkableFor(
    clinicId: string,
    plan: TreatmentPlan
  ): Promise<PlanAppointment[]> {
    const upcoming = await getAppointmentPort().upcomingForPatient(
      clinicId,
      plan.patientId,
      plan.doctorId,
      getISTDateString()
    );
    if (!upcoming.length) return [];
    const used = await database
      .select({ appointmentId: Link.appointmentId })
      .from(Link)
      .where(
        and(
          eq(Link.clinicId, clinicId),
          inArray(
            Link.appointmentId,
            upcoming.map((a) => a.id)
          ),
          isNull(Link.unlinkedAt)
        )
      );
    const taken = new Set(used.map((u) => u.appointmentId));
    return upcoming.filter((a) => !taken.has(a.id));
  }

  /** Uses a visit the patient already has for this step (4.4). */
  static async link(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    body: LinkStep
  ): Promise<PlanDetail> {
    await this.linkOne(clinicId, actor, planId, stepId, body);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** link() without reading the plan back, so "Book all" reads it once at the end. */
  private static async linkOne(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    body: LinkStep
  ): Promise<void> {
    const { plan, step, earliest } = await this.loadStep(
      clinicId,
      actor,
      planId,
      stepId
    );
    // Step 1 may also use today's visit with this doctor, even in progress or completed.
    const visit =
      (await this.linkable(clinicId, actor, planId)).find(
        (a) => a.id === body.appointmentId
      ) ??
      (step.seq === 1
        ? await this.todayVisit(clinicId, plan, body.appointmentId)
        : null);
    if (!visit)
      throw new HttpError(
        422,
        "That visit can't be used: it must be the patient's upcoming visit with this plan's doctor, not used by another step"
      );
    this.checkDate(
      actor,
      plan,
      step,
      earliest,
      visit.date,
      body.overrideReason
    );
    await database.transaction(async (tx) => {
      await this.attach(
        tx,
        plan,
        step,
        visit,
        actor,
        earliest,
        body.overrideReason
      );
      if (visit.status === 'Completed')
        await this.markDone(tx, plan, step.id, visit.id);
      // Same as on accept: money already taken on this visit counts for the step from now.
      else
        await PlanLedgerService.settleFromVisit(
          tx,
          plan,
          step.id,
          await getAppointmentPort().receivedOnVisitPaise(visit.id)
        );
    });
  }

  /** Today's open or finished visit with the plan's doctor, unused by any step; else null. */
  private static async todayVisit(
    clinicId: string,
    plan: TreatmentPlan,
    appointmentId: string
  ): Promise<PlanAppointment | null> {
    const visit = await getAppointmentPort().getAppointment(
      clinicId,
      appointmentId
    );
    if (
      !visit ||
      visit.patientId !== plan.patientId ||
      visit.doctorId !== plan.doctorId ||
      visit.date !== getISTDateString() ||
      DEAD_VISIT.includes(visit.status)
    )
      return null;
    const [used] = await database
      .select({ id: Link.id })
      .from(Link)
      .where(and(eq(Link.appointmentId, visit.id), isNull(Link.unlinkedAt)))
      .limit(1);
    return used ? null : visit;
  }

  /** On accept: the consultation the plan came from counts as its chosen step. Skipped quietly if it no longer fits. */
  static async countVisitAsStep(
    tx: Tx,
    plan: TreatmentPlan,
    actor: Actor,
    appointmentId: string
  ): Promise<void> {
    const visit = await getAppointmentPort().getAppointment(
      plan.clinicId,
      appointmentId
    );
    const [step] = await tx
      .select()
      .from(PlanStep)
      .where(
        and(
          eq(PlanStep.planId, plan.id),
          eq(PlanStep.seq, plan.consultationStepSeq ?? 1)
        )
      )
      .limit(1);
    if (
      !visit ||
      !step ||
      visit.patientId !== plan.patientId ||
      visit.doctorId !== plan.doctorId ||
      DEAD_VISIT.includes(visit.status) ||
      !BOOKABLE_STEP.includes(step.status as (typeof BOOKABLE_STEP)[number])
    )
      return;
    const [used] = await tx
      .select({ id: Link.id })
      .from(Link)
      .where(and(eq(Link.appointmentId, visit.id), isNull(Link.unlinkedAt)))
      .limit(1);
    if (used) return;
    // The consultation is usually before the accept day, so it is "early" by design.
    await this.attach(
      tx,
      plan,
      step,
      visit,
      actor,
      visit.date,
      'Treatment started in the consultation'
    );
    if (visit.status === 'Completed')
      await this.markDone(tx, plan, step.id, visit.id);
    // Not finished yet: what was paid at the desk today counts for the step now, not only on completion.
    else
      await PlanLedgerService.settleFromVisit(
        tx,
        plan,
        step.id,
        await getAppointmentPort().receivedOnVisitPaise(visit.id)
      );
  }

  /** Takes the step off its visit; the visit itself stays booked (4.4). */
  static async unlink(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string
  ): Promise<PlanDetail> {
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    const [current] = await database
      .select({ appointmentId: Link.appointmentId })
      .from(Link)
      .where(
        and(
          eq(Link.stepId, stepId),
          eq(Link.planId, planId),
          isNull(Link.unlinkedAt)
        )
      )
      .limit(1);
    const visit = current
      ? await getAppointmentPort().getAppointment(
          clinicId,
          current.appointmentId
        )
      : null;
    if (visit && STARTED_VISIT.includes(visit.status))
      throw new HttpError(
        409,
        "The patient has already arrived for this visit, so it can't be removed from the step"
      );
    const covered = await database.transaction(async (tx) => {
      const [live] = await tx
        .update(Link)
        .set({ unlinkedAt: new Date() })
        .where(
          and(
            eq(Link.stepId, stepId),
            eq(Link.planId, planId),
            isNull(Link.unlinkedAt)
          )
        )
        .returning();
      if (!live)
        throw new HttpError(
          409,
          'This visit was already cancelled or taken off the step. The plan now shows the latest.'
        );
      // A normal visit the plan was paying for gets its own price back.
      const covered =
        live.coveredType !== null ||
        live.coveredPrice !== null ||
        live.coveredPaymentMode !== null;
      if (covered)
        await getAppointmentPort().uncoverVisit(
          tx,
          live.appointmentId,
          actor.id,
          {
            type: live.coveredType,
            price: live.coveredPrice,
            primary: live.coveredPrimaryPrice,
            mode: live.coveredPaymentMode,
          }
        );
      await tx
        .update(PlanStep)
        .set({ gapOverrideReason: null })
        .where(eq(PlanStep.id, stepId));
      await PlanLedgerService.releaseVisitPayment(tx, plan, stepId, actor.id);
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'step_unlinked',
        meta: { stepId, appointmentId: live.appointmentId },
      });
      await this.recompute(tx, plan);
      return covered;
    });
    // After the step is free: a visit booked only for it would be an orphan ₹0 visit, so it is cancelled.
    // The cancel's own plan signal then finds no live link and changes nothing.
    // A covered normal visit was given back above and is kept.
    if (visit?.isPlanVisit && !covered)
      await getAppointmentPort().cancelPlanVisit(
        clinicId,
        visit.id,
        actor.id,
        actor.userType
      );
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Keeps a booked visit that an earlier change made too early: records the reason, which clears the flag. */
  static async keepEarly(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    reason: string
  ): Promise<PlanDetail> {
    // Same people who may book early in the first place.
    if (!actor.isDoctor && actor.userType !== 'Admin')
      throw new HttpError(
        403,
        'Only the doctor or an admin can keep a visit earlier than the gap'
      );
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    await database.transaction(async (tx) => {
      const [live] = await tx
        .select({ id: Link.id })
        .from(Link)
        .where(
          and(
            eq(Link.stepId, stepId),
            eq(Link.planId, plan.id),
            isNull(Link.unlinkedAt)
          )
        )
        .limit(1);
      if (!live)
        throw new HttpError(
          409,
          'This visit was already cancelled or taken off the step. The plan now shows the latest.'
        );
      await tx
        .update(PlanStep)
        .set({ gapOverrideReason: reason })
        .where(and(eq(PlanStep.id, stepId), eq(PlanStep.planId, plan.id)));
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'step_kept_early',
        reason,
        meta: { stepId },
      });
    });
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** A step done without a booked visit (walk-in): earlier steps must be finished, the day not before the last one. */
  static async markDoneWithoutVisit(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string,
    body: MarkStepDone
  ): Promise<PlanDetail> {
    if (!actor.isDoctor && actor.userType !== 'Admin')
      throw new HttpError(
        403,
        'Only the doctor or an admin can mark a step done without a visit'
      );
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    const { steps, bookedOn } = await this.timeline(database, plan);
    const i = steps.findIndex((s) => s.id === stepId);
    if (i < 0) throw new HttpError(404, 'Step not found');
    const step = steps[i];
    if (!BOOKABLE_STEP.includes(step.status as (typeof BOOKABLE_STEP)[number]))
      throw new HttpError(409, 'This step is already finished');
    if (bookedOn.has(step.id))
      throw new HttpError(
        409,
        'This step has a booked visit. Complete that visit, or unlink it first.'
      );
    const open = steps
      .slice(0, i)
      .find((s) => s.status !== 'done' && s.status !== 'skipped');
    if (open) throw new HttpError(409, `Finish step ${open.seq} first`);
    const today = getISTDateString();
    const doneOn = body.doneOn ?? today;
    const prev = steps[i - 1]?.doneAt;
    const notBefore = prev
      ? getISTDateString(prev)
      : getISTDateString(plan.acceptedAt ?? new Date());
    if (doneOn > today)
      throw new HttpError(422, 'Pick today or an earlier day');
    const dayLabel = (ymd: string) =>
      new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    if (doneOn < notBefore)
      throw new HttpError(
        422,
        `Pick ${dayLabel(notBefore)} or later: ${prev ? `session ${step.seq - 1} was done then` : 'the plan was accepted then'}`
      );
    // The plan's gap applies here too, as on booking: earlier needs a written reason, kept in the history.
    const planned = prev ? addDays(notBefore, step.gapDays) : notBefore;
    if (doneOn < planned && (body.note?.trim().length ?? 0) < 3)
      throw new HttpError(
        422,
        `Session ${step.seq} is planned ${step.gapDays} ${step.gapDays === 1 ? 'day' : 'days'} after session ${step.seq - 1}, from ${dayLabel(planned)}. To mark it done earlier, add a note saying why.`
      );
    await database.transaction(async (tx) => {
      // Same lock as booking, so a visit linked meanwhile can't end up on a step marked done here.
      await tx
        .select({ id: PlanStep.id })
        .from(PlanStep)
        .where(eq(PlanStep.id, step.id))
        .for('update');
      const [live] = await tx
        .select({ id: Link.id })
        .from(Link)
        .where(and(eq(Link.stepId, step.id), isNull(Link.unlinkedAt)))
        .limit(1);
      // Midday IST, so the stored time reads as the same IST day everywhere.
      const at =
        doneOn === today ? new Date() : new Date(`${doneOn}T12:00:00+05:30`);
      if (
        live ||
        !(await this.markDone(tx, plan, step.id, null, {
          at,
          actorId: actor.id,
          note: body.note,
        }))
      )
        throw new HttpError(
          409,
          'This step was just booked or finished by someone else. Reload to see it.'
        );
    });
    // The step's fee was just charged, so money screens refresh.
    signalPlanMoney(clinicId);
    return PlanQueryService.get(clinicId, actor, planId);
  }

  /** Ending a plan (Q29): frees its future visits not yet started, giving covered normal visits their own price
   *  back. Returns the plan-booked (₹0) ones for the caller to cancel after commit. */
  static async releaseOnEnd(
    tx: Tx,
    plan: TreatmentPlan,
    actor: Actor
  ): Promise<string[]> {
    const links = await tx
      .select()
      .from(Link)
      .where(and(eq(Link.planId, plan.id), isNull(Link.unlinkedAt)));
    const visits = await getAppointmentPort().getAppointments(
      plan.clinicId,
      links.map((l) => l.appointmentId)
    );
    const today = getISTDateString();
    const toCancel: string[] = [];
    for (const link of links) {
      const visit = visits.get(link.appointmentId);
      // A visit the patient came to, or one already gone, stays as it is.
      if (
        !visit ||
        visit.date < today ||
        STARTED_VISIT.includes(visit.status) ||
        DEAD_VISIT.includes(visit.status)
      )
        continue;
      await tx
        .update(Link)
        .set({ unlinkedAt: new Date() })
        .where(eq(Link.id, link.id));
      const covered =
        link.coveredType !== null ||
        link.coveredPrice !== null ||
        link.coveredPaymentMode !== null;
      if (covered)
        await getAppointmentPort().uncoverVisit(tx, visit.id, actor.id, {
          type: link.coveredType,
          price: link.coveredPrice,
          primary: link.coveredPrimaryPrice,
          mode: link.coveredPaymentMode,
        });
      else if (visit.isPlanVisit) toCancel.push(visit.id);
      await TreatmentHistoryService.record(tx, {
        clinicId: plan.clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'step_unlinked',
        meta: { stepId: link.stepId, appointmentId: visit.id },
      });
    }
    return toCancel;
  }

  /** Steps linked to one visit, for the consultation's "This visit" card (4.8). */
  static async visitSteps(
    clinicId: string,
    actor: Actor,
    appointmentId: string
  ): Promise<{
    steps: VisitStep[];
    pendingPlan: { id: string; title: string } | null;
    releasedStep: ReleasedStep | null;
  }> {
    const steps = (
      await this.visitStepsFor(clinicId, actor, [appointmentId])
    ).map(({ appointmentId: _a, ...s }) => s);
    if (!steps.length) {
      // A plan visit cancelled or missed has no fee of its own; without the step it was for, its page shows a blank service.
      const releasedStep = await this.releasedStepOf(
        clinicId,
        actor,
        appointmentId
      );
      if (releasedStep) return { steps, pendingPlan: null, releasedStep };
    }
    // A visit already on a plan has no pending proposal to show, so it skips the lookup.
    // A normal paid visit counted as a step settles it with its own payment, so only a plan-booked
    // (₹0) visit asks for the plan share; otherwise the patient would be asked twice.
    const visit = steps.length
      ? await getAppointmentPort().getAppointment(clinicId, appointmentId)
      : null;
    // A normal visit's desk money moves to the plan on completion; read once, so reception doesn't take it twice.
    const paidPaise =
      visit && !visit.isPlanVisit && steps.some((s) => s.status !== 'done')
        ? await getAppointmentPort().receivedOnVisitPaise(appointmentId)
        : 0;
    const [withFees, pendingPlan] = await Promise.all([
      Promise.all(
        steps.map(async (s) =>
          this.withStepPrice(
            visit?.isPlanVisit
              ? await this.withTodayFee(s)
              : s.status !== 'done' && paidPaise > 0
                ? { ...s, paidOnVisit: fromPaise(paidPaise) }
                : s
          )
        )
      ),
      steps.length
        ? null
        : PlanQueryService.pendingForVisit(clinicId, appointmentId),
    ]);
    return { steps: withFees, pendingPlan, releasedStep: null };
  }

  /** The step's real price for the visit page (one-visit read only, so lists pay no extra queries). */
  private static async withStepPrice(step: VisitStep): Promise<VisitStep> {
    const [plan] = await database
      .select()
      .from(P)
      .where(eq(P.id, step.planId))
      .limit(1);
    if (!plan) return step;
    const price = await PlanLedgerService.stepPrice(
      database,
      plan,
      step.stepId
    );
    return price === null ? step : { ...step, stepPrice: fromPaise(price) };
  }

  /** The step a plan-booked visit was for, once that visit was cancelled or missed and the step freed. */
  private static async releasedStepOf(
    clinicId: string,
    actor: Actor,
    appointmentId: string
  ): Promise<ReleasedStep | null> {
    // Link first (indexed by appointment): a visit never on a plan stops here after one lookup.
    const [row] = await database
      .select({
        planId: P.id,
        planTitle: P.title,
        name: PlanStep.name,
        seq: PlanStep.seq,
        stepsTotal: sql<number>`(select count(*)::int from treatment_plan_steps c where c.plan_id = ${P}.id)`,
      })
      .from(Link)
      .innerJoin(PlanStep, eq(PlanStep.id, Link.stepId))
      .innerJoin(P, eq(P.id, Link.planId))
      .where(
        and(eq(Link.clinicId, clinicId), eq(Link.appointmentId, appointmentId))
      )
      .orderBy(desc(Link.unlinkedAt))
      .limit(1);
    if (!row) return null;
    const [visit, scope] = await Promise.all([
      getAppointmentPort().getAppointment(clinicId, appointmentId),
      PlanQueryService.visible(clinicId, actor),
    ]);
    if (!visit?.isPlanVisit || !DEAD_VISIT.includes(visit.status)) return null;
    const [allowed] = await database
      .select({ id: P.id })
      .from(P)
      .where(and(eq(P.id, row.planId), scope))
      .limit(1);
    return allowed ? { ...row, visitStatus: visit.status } : null;
  }

  /** Per-visit billing: the step's share less any credit (an advance not used yet). Only for the
   *  one-visit read, so the list views pay no extra queries. */
  private static async withTodayFee(step: VisitStep): Promise<VisitStep> {
    if (step.status === 'done' || !PER_VISIT.includes(step.billingMode ?? ''))
      return step;
    const [plan] = await database
      .select()
      .from(P)
      .where(eq(P.id, step.planId))
      .limit(1);
    if (!plan) return step;
    const share = await PlanLedgerService.stepShare(
      database,
      plan,
      step.stepId
    );
    if (share === null) return step;
    const credit = Math.max(0, -toPaise(step.planDue));
    return { ...step, todayFee: fromPaise(Math.max(0, share - credit)) };
  }

  /** From the appointment: accepted plans whose step 1 this visit can count as (today, same doctor, step 1 free). */
  static async countableFor(
    clinicId: string,
    actor: Actor,
    appointmentId: string
  ): Promise<
    { planId: string; planTitle: string; stepId: string; stepName: string }[]
  > {
    const visit = await getAppointmentPort().getAppointment(
      clinicId,
      appointmentId
    );
    if (
      !visit?.doctorId ||
      visit.date !== getISTDateString() ||
      DEAD_VISIT.includes(visit.status)
    )
      return [];
    const scope = await PlanQueryService.visible(clinicId, actor);
    const [linked] = await database
      .select({ id: Link.id })
      .from(Link)
      .where(and(eq(Link.appointmentId, visit.id), isNull(Link.unlinkedAt)))
      .limit(1);
    if (linked) return [];
    const rows = await database
      .select({
        planId: P.id,
        planTitle: P.title,
        stepId: PlanStep.id,
        stepName: PlanStep.name,
      })
      .from(P)
      .innerJoin(PlanStep, and(eq(PlanStep.planId, P.id), eq(PlanStep.seq, 1)))
      .where(
        and(
          eq(P.clinicId, clinicId),
          eq(P.patientId, visit.patientId),
          eq(P.doctorId, visit.doctorId),
          inArray(P.status, [...BOOKABLE_PLAN]),
          inArray(PlanStep.status, [...BOOKABLE_STEP]),
          // Outer table named explicitly: drizzle prints ${PlanStep.id} as a bare "id", which binds to l.
          sql`not exists (select 1 from ${Link} l where l.step_id = ${PlanStep}.id and l.unlinked_at is null)`,
          scope
        )
      )
      .orderBy(asc(P.title));
    return rows;
  }

  /** Plan steps for many visits at once, for the plan tag on appointment lists. */
  static async visitStepsFor(
    clinicId: string,
    actor: Actor,
    appointmentIds: string[]
  ): Promise<(VisitStep & { appointmentId: string })[]> {
    if (!appointmentIds.length) return [];
    const scope = await PlanQueryService.visible(clinicId, actor);
    const rows = await database
      .select({
        appointmentId: Link.appointmentId,
        planId: P.id,
        planTitle: P.title,
        doctorId: P.doctorId,
        stepId: PlanStep.id,
        seq: PlanStep.seq,
        name: PlanStep.name,
        status: PlanStep.status,
        // Money on the same read, so the appointment page needs no plan request.
        planDuePaise: planDuePaise(sql.raw('treatment_plans.id')),
        leftToPayPaise: planLeftToPayPaise(sql.raw('treatment_plans.id')),
        planTotal: P.totalAmount,
        billingMode: P.billingMode,
        stepFee: PlanStep.fee,
        stepsTotal: sql<number>`(select count(*)::int from treatment_plan_steps c where c.plan_id = treatment_plans.id)`,
      })
      .from(Link)
      .innerJoin(PlanStep, eq(PlanStep.id, Link.stepId))
      .innerJoin(P, eq(P.id, Link.planId))
      .where(
        and(
          eq(Link.clinicId, clinicId),
          inArray(Link.appointmentId, appointmentIds),
          isNull(Link.unlinkedAt),
          scope
        )
      )
      .orderBy(asc(P.title), asc(PlanStep.seq));
    return rows.map(
      ({ doctorId, planDuePaise: due, leftToPayPaise: left, ...r }) => ({
        ...r,
        planDue: fromPaise(Number(due)),
        planLeftToPay: fromPaise(Number(left)),
        isPlanDoctor: doctorId === actor.id,
      })
    );
  }

  /** Called by the appointments side after commit (§7). Never throws: a plan problem must not
   *  break an appointment change; it is logged and the next change re-checks the dates. */
  /** Steps still on a visit that ended as no-show or cancelled outside the app's change path (the day-end job). */
  static async syncDeadVisits(): Promise<number> {
    // ponytail: scans every live link of open plans; filter by visit date in the port if this grows.
    const links = await database
      .select({ clinicId: Link.clinicId, appointmentId: Link.appointmentId })
      .from(Link)
      .innerJoin(P, eq(P.id, Link.planId))
      .where(
        and(
          isNull(Link.unlinkedAt),
          inArray(P.status, ['paused', ...BOOKABLE_PLAN])
        )
      );
    const byClinic = new Map<string, string[]>();
    for (const l of links)
      byClinic.set(l.clinicId, [
        ...(byClinic.get(l.clinicId) ?? []),
        l.appointmentId,
      ]);
    let synced = 0;
    for (const [clinicId, ids] of byClinic) {
      const visits = await getAppointmentPort().getAppointments(clinicId, ids);
      for (const v of visits.values()) {
        const kind =
          v.status === 'NoShow' || v.status === 'Missed'
            ? 'no_show'
            : v.status === 'Cancelled'
              ? 'cancelled'
              : null;
        if (!kind) continue;
        await this.onAppointmentChanged({
          appointmentId: v.id,
          clinicId,
          kind,
          date: v.date,
        });
        synced++;
      }
    }
    return synced;
  }

  static async onAppointmentChanged(
    event: AppointmentChangedEvent
  ): Promise<void> {
    try {
      const links = await database
        .select()
        .from(Link)
        .where(
          and(
            eq(Link.clinicId, event.clinicId),
            eq(Link.appointmentId, event.appointmentId),
            isNull(Link.unlinkedAt)
          )
        );
      // A cancel is someone's decision: history names them and their reason instead of "Automatic".
      const cancel =
        links.length && event.kind === 'cancelled'
          ? await getAppointmentPort().cancellationOf(event.appointmentId)
          : null;
      for (const link of links) {
        await database.transaction(async (tx) => {
          const [plan] = await tx
            .select()
            .from(P)
            .where(eq(P.id, link.planId))
            .for('update');
          if (!plan) return;
          // A booked step is done when its visit is completed; only a step with no visit is marked by hand (Q26).
          // A visit kept while paused still counts: the patient came.
          if (event.kind === 'completed') {
            if (
              (['paused', ...BOOKABLE_PLAN] as string[]).includes(plan.status)
            )
              await this.markDone(tx, plan, link.stepId, link.appointmentId);
            return;
          }
          if (event.kind !== 'rescheduled') {
            // Missed or cancelled: the visit no longer serves the step, which is free to rebook.
            await tx
              .update(Link)
              .set({ unlinkedAt: new Date() })
              .where(eq(Link.id, link.id));
            const [step] = await tx
              .update(PlanStep)
              .set({
                status: event.kind === 'no_show' ? 'missed' : 'pending',
                gapOverrideReason: null,
              })
              .where(
                and(
                  eq(PlanStep.id, link.stepId),
                  inArray(PlanStep.status, [...BOOKABLE_STEP])
                )
              )
              .returning({ id: PlanStep.id });
            if (step)
              await PlanLedgerService.releaseVisitPayment(
                tx,
                plan,
                link.stepId,
                cancel?.actorId ?? null
              );
            if (step)
              await TreatmentHistoryService.record(tx, {
                clinicId: plan.clinicId,
                planId: plan.id,
                actorId: cancel?.actorId ?? null,
                action:
                  event.kind === 'no_show' ? 'step_missed' : 'step_unlinked',
                // toValue marks a cancelled visit apart from one only taken off the step.
                toValue: event.kind === 'cancelled' ? 'Cancelled' : null,
                // The cancel note may be up to 500 characters; the history column holds 255.
                reason: cancel?.reason?.slice(0, 255) ?? null,
                meta: {
                  stepId: link.stepId,
                  appointmentId: link.appointmentId,
                },
              });
          }
          await this.recompute(tx, plan);
        });
      }
      // After commit, so an open plan page that reloads on this reads the freed or finished step.
      if (links.length) signalPlanChange(event.clinicId);
    } catch (err) {
      logger.error('[TreatmentPlan] appointment change not applied to plans', {
        appointmentId: event.appointmentId,
        kind: event.kind,
        message: (err as Error).message,
      });
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** The step's visit was completed: the step is done; the first moves the plan into treatment,
   *  the last completes it (4.6). A step already finished is left alone, so a rerun is harmless. */
  private static async markDone(
    tx: Tx,
    plan: TreatmentPlan,
    stepId: string,
    appointmentId: string | null,
    // Only for a step done without a visit: who said so, when, and their note.
    manual?: { at: Date; actorId: string; note?: string }
  ): Promise<boolean> {
    const [step] = await tx
      .update(PlanStep)
      .set({
        status: 'done',
        doneAt: manual?.at ?? new Date(),
        doneAppointmentId: appointmentId,
      })
      .where(
        and(
          eq(PlanStep.id, stepId),
          inArray(PlanStep.status, [...BOOKABLE_STEP])
        )
      )
      .returning({ id: PlanStep.id });
    if (!step) return false;
    await TreatmentHistoryService.record(tx, {
      clinicId: plan.clinicId,
      planId: plan.id,
      actorId: manual?.actorId ?? null,
      action: 'step_done',
      notes: manual?.note || null,
      meta: { stepId, ...(appointmentId ? { appointmentId } : {}) },
    });
    // Its share of the agreed total is charged now (§6, Q18).
    await PlanLedgerService.chargeStep(tx, plan, stepId);
    // A normal paid visit did this step: what was paid there settles it (up to its charge), once.
    if (appointmentId)
      await PlanLedgerService.settleFromVisit(
        tx,
        plan,
        stepId,
        await getAppointmentPort().receivedOnVisitPaise(appointmentId)
      );
    const left = await tx
      .select({ id: PlanStep.id })
      .from(PlanStep)
      .where(
        and(
          eq(PlanStep.planId, plan.id),
          notInArray(PlanStep.status, ['done', 'skipped'])
        )
      )
      .limit(1);
    const next = !left.length
      ? 'completed'
      : plan.status === 'accepted'
        ? 'in_treatment'
        : null;
    if (next) {
      await tx
        .update(P)
        .set({
          status: next,
          ...(next === 'completed' ? { completedAt: new Date() } : {}),
          // The template's check-up reminder, counted from today; a date staff set by hand stays.
          ...(next === 'completed' && !plan.recallDate && plan.recallAfterDays
            ? {
                recallDate: addDays(getISTDateString(), plan.recallAfterDays),
              }
            : {}),
        })
        .where(eq(P.id, plan.id));
      await TreatmentHistoryService.record(tx, {
        clinicId: plan.clinicId,
        planId: plan.id,
        actorId: null,
        action: 'status_change',
        fromValue: plan.status,
        toValue: next,
        meta: null,
      });
    }
    await this.recompute(tx, plan);
    return true;
  }

  /** Links the visit, records any early-booking reason, and re-dates the later steps. */
  private static async attach(
    tx: Tx,
    plan: TreatmentPlan,
    step: TreatmentPlanStep,
    visit: PlanAppointment,
    actor: Actor,
    earliest: string,
    overrideReason: string | undefined
  ): Promise<void> {
    const [locked] = await tx
      .select({ status: PlanStep.status })
      .from(PlanStep)
      .where(eq(PlanStep.id, step.id))
      .for('update');
    const [live] = await tx
      .select({ id: Link.id })
      .from(Link)
      .where(and(eq(Link.stepId, step.id), isNull(Link.unlinkedAt)))
      .limit(1);
    if (
      live ||
      !BOOKABLE_STEP.includes(locked.status as (typeof BOOKABLE_STEP)[number])
    )
      throw new HttpError(
        409,
        'This step was just booked by someone else. Reload to see it.'
      );
    // A normal visit not paid yet becomes plan-paid, or the patient would pay twice for it.
    const coveredFrom = visit.isPlanVisit
      ? null
      : await getAppointmentPort().coverVisit(tx, visit.id, actor.id);
    await tx.insert(Link).values({
      clinicId: plan.clinicId,
      stepId: step.id,
      planId: plan.id,
      appointmentId: visit.id,
      linkedBy: actor.id,
      coveredType: coveredFrom?.type ?? null,
      coveredPrice: coveredFrom?.price ?? null,
      coveredPrimaryPrice: coveredFrom?.primary ?? null,
      coveredPaymentMode: coveredFrom?.mode ?? null,
    });
    const early = visit.date < earliest;
    await tx
      .update(PlanStep)
      .set({
        status: 'pending',
        gapOverrideReason: early ? overrideReason! : null,
      })
      .where(eq(PlanStep.id, step.id));
    await TreatmentHistoryService.record(tx, {
      clinicId: plan.clinicId,
      planId: plan.id,
      actorId: actor.id,
      action: 'step_linked',
      meta: { stepId: step.id, appointmentId: visit.id },
    });
    if (early)
      await TreatmentHistoryService.record(tx, {
        clinicId: plan.clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'gap_override',
        reason: overrideReason,
        meta: {
          stepId: step.id,
          earliestDate: earliest,
          bookedDate: visit.date,
        },
      });
    await this.recompute(tx, plan);
  }

  /** Earlier than the step's earliest day needs a reason, and only the doctor or an admin may give it. */
  private static checkDate(
    actor: Actor,
    plan: TreatmentPlan,
    step: TreatmentPlanStep,
    earliest: string,
    date: string,
    overrideReason: string | undefined
  ): void {
    if (date < getISTDateString())
      throw new HttpError(422, 'Pick today or a later date');
    // §6.1: no session after the package's last day (Q29); the plan load already refuses an ended one.
    if (plan.packageExpiresOn && date > plan.packageExpiresOn)
      throw new HttpError(
        422,
        `This package ends on ${new Date(`${plan.packageExpiresOn}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. Pick a day on or before it, or extend the package.`
      );
    if (date >= earliest) return;
    if (!actor.isDoctor && actor.userType !== 'Admin')
      throw new HttpError(
        403,
        `Step ${step.seq} can be booked from ${earliest}. Only the doctor or an admin can book earlier.`
      );
    if (!overrideReason)
      throw new HttpError(
        422,
        `Step ${step.seq} is earliest on ${earliest}; give a reason to book earlier`,
        {
          code: 'EARLY_BOOKING',
          earliestDate: earliest,
        }
      );
  }

  /** Stores each step's earliest day (§5); runs after every booking change. */
  static async recompute(tx: Tx, plan: TreatmentPlan): Promise<void> {
    if (!plan.acceptedAt) return;
    const { steps, earliest } = await this.timeline(tx, plan);
    for (const [i, s] of steps.entries())
      if (s.earliestDate !== earliest[i])
        await tx
          .update(PlanStep)
          .set({ earliestDate: earliest[i] })
          .where(eq(PlanStep.id, s.id));
  }

  /** Steps in order with their booked days and the earliest days the rule gives them. */
  private static async timeline(db: Db, plan: TreatmentPlan) {
    const [steps, links] = await Promise.all([
      db
        .select()
        .from(PlanStep)
        .where(eq(PlanStep.planId, plan.id))
        .orderBy(asc(PlanStep.seq)),
      db
        .select({ stepId: Link.stepId, appointmentId: Link.appointmentId })
        .from(Link)
        .where(and(eq(Link.planId, plan.id), isNull(Link.unlinkedAt))),
    ]);
    const visits = await getAppointmentPort().getAppointments(
      plan.clinicId,
      links.map((l) => l.appointmentId)
    );
    const bookedOn = new Map(
      links.flatMap((l) => {
        const v = visits.get(l.appointmentId);
        return v ? [[l.stepId, v.date] as const] : [];
      })
    );
    const start = getISTDateString(plan.acceptedAt ?? new Date());
    const timing = steps.map((s) => ({
      gapDays: s.gapDays,
      maxGapDays: s.maxGapDays,
      status: s.status,
      doneOn: s.doneAt ? getISTDateString(s.doneAt) : null,
      bookedOn: bookedOn.get(s.id) ?? null,
    }));
    const earliest = earliestDates(start, timing);
    return {
      steps,
      bookedOn,
      earliest,
      lateAfter: lateAfterDates(start, timing),
    };
  }

  private static async loadBookablePlan(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<TreatmentPlan> {
    const scope = await PlanQueryService.visible(clinicId, actor);
    const [plan] = await database
      .select()
      .from(P)
      .where(and(eq(P.id, planId), scope))
      .limit(1);
    if (!plan) throw new HttpError(404, 'Treatment plan not found');
    if (plan.status === 'paused')
      throw new HttpError(
        409,
        'This plan is paused. Resume it to book visits.'
      );
    if (!BOOKABLE_PLAN.includes(plan.status as (typeof BOOKABLE_PLAN)[number]))
      throw new HttpError(
        409,
        'Steps are booked once the patient has accepted the plan'
      );
    if (plan.packageExpiresOn && plan.packageExpiresOn < getISTDateString())
      throw new HttpError(
        409,
        `This package ended on ${plan.packageExpiresOn}. Extend it to book more sessions.`
      );
    return plan;
  }

  /** The plan, the step and its current earliest day (worked out fresh, not trusted from the column). */
  private static async loadStep(
    clinicId: string,
    actor: Actor,
    planId: string,
    stepId: string
  ) {
    const plan = await this.loadBookablePlan(clinicId, actor, planId);
    const { steps, bookedOn, earliest, lateAfter } = await this.timeline(
      database,
      plan
    );
    const i = steps.findIndex((s) => s.id === stepId);
    if (i < 0) throw new HttpError(404, 'Step not found');
    const step = steps[i];
    if (!BOOKABLE_STEP.includes(step.status as (typeof BOOKABLE_STEP)[number]))
      throw new HttpError(409, 'This step is already finished');
    if (bookedOn.has(step.id))
      throw new HttpError(
        409,
        'This step already has a visit. Unlink it first to change it.'
      );
    const day = earliest[i];
    if (!day) throw new HttpError(409, `Book step ${step.seq - 1} first`);
    return { plan, step, earliest: day, lateAfter: lateAfter[i] };
  }
}
