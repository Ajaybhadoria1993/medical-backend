import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import logger from '../../../../utils/logger';
import { HttpError } from '../../../../middlewear/errorHandler';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  TreatmentStepAppointmentModel as Link,
  TreatmentPlanVersionModel as Version,
  type TreatmentPlan,
  type TreatmentPlanStep,
} from '../../models/treatmentPlan.model';
import { TreatmentInstalmentModel as Instalment } from '../../models/treatmentLedger.model';
import { TreatmentPlanHistoryModel as History } from '../../models/treatmentPlanHistory.model';
import {
  getAppointmentPort,
  getFilePort,
  getPatientPort,
  getStaffScopePort,
  type PlanAppointment,
} from '../../ports';
import type { PlanListQuery } from '../../schemas/plan.schema';
import type {
  PlanDetail,
  PlanDeskCall,
  PlanFollowUp,
  PlanListItem,
  PlanConsentForm,
  PlanStepPayment,
  PlanSuggestion,
  PrescriptionPlan,
} from '../../types/plan.types';
import type { HistoryMetaByAction } from '../../types/history.types';
import type { Actor } from '../../types/template.types';
import { escapeLike } from '../../utils/db.utils';
import { printableOptions } from '../../utils/planRules.utils';
import {
  addDays,
  earliestDates,
  lateAfterDates,
} from '../../utils/timing.utils';
import { getISTDateString } from '../../../../utils/istDateTime';
import {
  fromPaise,
  collectNow,
  planBalance,
  stepChargePaise,
  toPaise,
} from '../../utils/money.utils';
import { matchTemplates } from '../../utils/suggestions.utils';
import { TemplateQueryService } from '../templates/templateQuery.service';
import {
  PlanMoneyStore,
  planDuePaise,
  planLeftToPayPaise,
} from './planMoney.service';

// The outer table is named explicitly: drizzle prints ${P.id} as a bare "id", which binds to the steps table.
const stepsTotal = sql<number>`(select count(*)::int from ${PlanStep} s where s.plan_id = ${P}.id)`;
// A proposal lists once: a suggested option shows only as its group's first, and the options
// declined because a sibling was accepted are not listed at all.
const onePerProposal = sql`not (
  (${P.status} = 'proposed' and exists (select 1 from treatment_plans o where o.proposal_group_id = ${P.proposalGroupId}
    and o.id <> ${P.id} and o.status = 'proposed' and coalesce(o.option_label, '') < coalesce(${P.optionLabel}, '')))
  or (${P.status} = 'declined' and exists (select 1 from treatment_plans o where o.proposal_group_id = ${P.proposalGroupId}
    and o.id <> ${P.id} and o.accepted_at is not null))
)`;
// Active, no visit booked on any open step, and an open step was due more than 30 days ago.
const STALLED_DAYS = 30;
const stalledSql = sql<boolean>`(${P.status} in ('accepted', 'in_treatment')
  and not exists (select 1 from treatment_step_appointments l where l.plan_id = ${P.id} and l.unlinked_at is null
    and exists (select 1 from treatment_plan_steps x where x.id = l.step_id and x.status in ('pending', 'missed')))
  and exists (select 1 from treatment_plan_steps s where s.plan_id = ${P.id} and s.status in ('pending', 'missed')
    and s.earliest_date is not null and s.earliest_date < (now() at time zone 'Asia/Kolkata')::date - ${sql.raw(String(STALLED_DAYS))}))`;
const dueSql = planDuePaise(sql.raw('treatment_plans.id'));
const leftToPaySql = planLeftToPayPaise(sql.raw('treatment_plans.id'));
const groupOptions = (agg: string) =>
  sql.raw(
    `(select ${agg} from treatment_plans o where o.proposal_group_id = treatment_plans.proposal_group_id and o.status = treatment_plans.status)`
  );
const stepsDone = sql<number>`(select count(*)::int from ${PlanStep} s where s.plan_id = ${P}.id and s.status = 'done')`;

// History rows sent with the plan; the rest load on demand.
const DETAIL_HISTORY = 10;

/** "1" once a clinic has any plan; "0" (for a day) when it has none, so the dashboard skips the count. */
export const hasPlansKey = (clinicId: string) => `tp:has-plans:${clinicId}`;

// First open step with no live visit (earlier ones may be booked, so the gap after them shows), unless the desk marked it done.
const nextOpenUnbookedStep =
  sql.raw(`not exists (select 1 from treatment_plan_steps s2 where s2.plan_id = treatment_plan_steps.plan_id
    and s2.status in ('pending', 'missed') and s2.seq < treatment_plan_steps.seq
    and not exists (select 1 from treatment_step_appointments l2 where l2.step_id = s2.id and l2.unlinked_at is null))
  and not exists (select 1 from treatment_step_appointments l where l.step_id = treatment_plan_steps.id and l.unlinked_at is null)
  and not exists (select 1 from treatment_plan_history h where h.plan_id = treatment_plan_steps.plan_id
    and h.action = 'follow_up_dismissed' and h.meta->>'refId' = treatment_plan_steps.id::text)`);
// A call-back or check-up the desk marked done stays off the list; each kind is closed on its own.
const planRowNotDismissed =
  sql.raw(`not exists (select 1 from treatment_plan_history h where h.plan_id = treatment_plans.id
  and h.action = 'follow_up_dismissed' and h.meta->>'refId' = treatment_plans.id::text
  and h.meta->>'kind' = case when treatment_plans.status = 'completed' then 'plan_checkup' else 'plan_callback' end)`);

export class PlanQueryService {
  /** Visits to book, think-it-over call-backs and check-ups due between two IST days, for the reception follow-up list. */
  static async dueFollowUps(
    clinicId: string,
    actor: Actor,
    from: string,
    to: string,
    limit: number,
    patientIds: string[] | null
  ): Promise<PlanFollowUp[]> {
    const visible = await this.visible(clinicId, actor);
    const forPatients = patientIds
      ? inArray(P.patientId, patientIds)
      : undefined;
    const stepDue = sql<string>`coalesce(${PlanStep.earliestDate}, (${P.acceptedAt} at time zone 'Asia/Kolkata')::date)`;
    const planDue = sql<string>`coalesce(${P.followUpDate}, ${P.recallDate})`;
    const [steps, plans] = await Promise.all([
      database
        .select({
          planId: P.id,
          planTitle: P.title,
          patientId: P.patientId,
          doctorId: P.doctorId,
          stepId: PlanStep.id,
          stepName: PlanStep.name,
          stepSeq: PlanStep.seq,
          stepStatus: PlanStep.status,
          stepCount: stepsTotal,
          planStatus: P.status,
          dueDate: sql<string>`${stepDue}::text`,
        })
        .from(PlanStep)
        .innerJoin(P, eq(PlanStep.planId, P.id))
        .where(
          and(
            visible,
            forPatients,
            inArray(P.status, ['accepted', 'in_treatment']),
            or(
              eq(PlanStep.status, 'missed'),
              and(
                eq(PlanStep.status, 'pending'),
                or(
                  eq(PlanStep.seq, 1),
                  sql`${PlanStep.earliestDate} is not null`
                )
              )
            ),
            nextOpenUnbookedStep,
            sql`${stepDue} between ${from}::date and ${to}::date`
          )
        )
        .orderBy(stepDue)
        .limit(limit),
      database
        .select({
          planId: P.id,
          planTitle: P.title,
          patientId: P.patientId,
          doctorId: P.doctorId,
          status: P.status,
          dueDate: sql<string>`${planDue}::text`,
        })
        .from(P)
        .where(
          and(
            visible,
            forPatients,
            onePerProposal,
            planRowNotDismissed,
            or(
              // A "no" with a try-again day is called back like a "will decide".
              and(
                inArray(P.status, ['proposed', 'declined']),
                isNotNull(P.followUpDate)
              ),
              and(eq(P.status, 'completed'), isNotNull(P.recallDate))
            ),
            sql`${planDue} between ${from}::date and ${to}::date`
          )
        )
        .orderBy(planDue)
        .limit(limit),
    ]);
    return [
      ...steps.map((s) => ({
        kind: 'plan_step' as const,
        ...s,
      })),
      ...plans.map(({ status, ...p }) => ({
        kind:
          status === 'completed'
            ? ('plan_checkup' as const)
            : ('plan_callback' as const),
        ...p,
        planStatus: status,
        stepId: null,
        stepName: null,
        stepSeq: null,
        stepStatus: null,
        stepCount: null,
      })),
    ];
  }

  /** Logged follow-up calls on plans the actor may see, newest first. */
  static async calls(
    clinicId: string,
    actor: Actor,
    planIds: string[]
  ): Promise<PlanDeskCall[]> {
    if (!planIds.length) return [];
    const visible = await this.visible(clinicId, actor);
    const rows = await database
      .select({
        planId: History.planId,
        outcome: History.toValue,
        notes: History.notes,
        meta: History.meta,
        actorId: History.actorId,
        at: History.createdAt,
      })
      .from(History)
      .innerJoin(P, eq(History.planId, P.id))
      .where(
        and(
          visible,
          inArray(History.planId, planIds),
          eq(History.action, 'follow_up_call')
        )
      )
      .orderBy(desc(History.createdAt))
      .limit(200);
    return rows.map(({ meta, ...r }) => ({
      ...r,
      planId: r.planId as string,
      nextCallDate:
        (meta as { nextFollowUpDate?: string } | null)?.nextFollowUpDate ??
        null,
    }));
  }

  static async isVisible(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<boolean> {
    const visible = await this.visible(clinicId, actor);
    const [row] = await database
      .select({ id: P.id })
      .from(P)
      .where(and(visible, eq(P.id, planId)))
      .limit(1);
    return !!row;
  }

  /** Plans waiting for the patient's answer and plans under way, for the dashboard card.
   *  A clinic that has never made a plan costs one Redis read, no database query. */
  static async statusCounts(
    clinicId: string
  ): Promise<{ waiting: number; inTreatment: number }> {
    const none = { waiting: 0, inTreatment: 0 };
    let flag: string | null = null;
    try {
      flag = await redisClient.get(hasPlansKey(clinicId));
    } catch (err) {
      logger.warn(
        '[TreatmentPlan] has-plans flag read failed; counting directly',
        err
      );
    }
    if (flag === '0') return none;
    if (flag === null) {
      const [any] = await database
        .select({ id: P.id })
        .from(P)
        .where(eq(P.clinicId, clinicId))
        .limit(1);
      try {
        // No plan yet: remember for a day (creating one flips it at once). Has plans: no expiry.
        if (any) await redisClient.set(hasPlansKey(clinicId), '1');
        else await redisClient.setex(hasPlansKey(clinicId), 86400, '0');
      } catch (err) {
        logger.warn('[TreatmentPlan] has-plans flag write failed', err);
      }
      if (!any) return none;
    }
    const [row] = await database
      .select({
        waiting: sql<number>`COUNT(*) FILTER (WHERE ${P.status} = 'proposed')::int`,
        inTreatment: sql<number>`COUNT(*) FILTER (WHERE ${P.status} IN ('accepted', 'in_treatment'))::int`,
      })
      .from(P)
      .where(
        and(
          eq(P.clinicId, clinicId),
          inArray(P.status, ['proposed', 'accepted', 'in_treatment'])
        )
      );
    return { waiting: row?.waiting ?? 0, inTreatment: row?.inTreatment ?? 0 };
  }

  /** A plan proposed from this visit and still waiting for the patient's answer (option A first).
   *  Uses the clinic + status index; proposed plans per clinic are few. */
  static async pendingForVisit(
    clinicId: string,
    appointmentId: string
  ): Promise<{ id: string; title: string } | null> {
    const [row] = await database
      .select({ id: P.id, title: P.title })
      .from(P)
      .where(
        and(
          eq(P.clinicId, clinicId),
          eq(P.status, 'proposed'),
          eq(P.consultationAppointmentId, appointmentId)
        )
      )
      .orderBy(asc(P.optionLabel))
      .limit(1);
    return row ?? null;
  }

  /** Plans suggested at this visit, for its prescription. While a proposal is open every option
   *  prints; once one is accepted only that one does. Declined and ended plans never print. */
  static async forPrescription(
    clinicId: string,
    patientId: string,
    appointmentId: string
  ): Promise<PrescriptionPlan[]> {
    const plans = await database
      .select({
        id: P.id,
        proposalGroupId: P.proposalGroupId,
        title: P.title,
        optionLabel: P.optionLabel,
        optionName: P.optionName,
        status: P.status,
      })
      .from(P)
      .where(
        and(
          eq(P.clinicId, clinicId),
          eq(P.patientId, patientId),
          eq(P.consultationAppointmentId, appointmentId),
          sql`${P.status} NOT IN ('declined', 'ended_early')`
        )
      )
      .orderBy(asc(P.createdAt), asc(P.optionLabel));
    if (!plans.length) return [];

    const printed = printableOptions(plans);

    const steps = await database
      .select({
        planId: PlanStep.planId,
        seq: PlanStep.seq,
        name: PlanStep.name,
        gapDays: PlanStep.gapDays,
      })
      .from(PlanStep)
      .where(
        and(
          inArray(
            PlanStep.planId,
            printed.map((p) => p.id)
          ),
          sql`${PlanStep.status} <> 'skipped'`
        )
      )
      .orderBy(asc(PlanStep.seq));

    return printed.map((p) => ({
      title: p.title,
      optionLabel: p.optionLabel,
      optionName: p.optionName,
      status: p.status,
      steps: steps
        .filter((s) => s.planId === p.id)
        .map(({ seq, name, gapDays }) => ({ seq, name, gapDays })),
    }));
  }

  /** Plans the caller may see (Q9): Admin the clinic, a Doctor their own, a Receptionist their
   *  assigned doctors' (same rule as appointments). Always inside the clinic from the token. */
  static async visible(clinicId: string, actor: Actor): Promise<SQL> {
    const inClinic = eq(P.clinicId, clinicId);
    if (actor.userType === 'Doctor')
      return and(inClinic, eq(P.doctorId, actor.id))!;
    const doctorIds = await getStaffScopePort().getAccessibleDoctorIds(
      actor,
      clinicId
    );
    if (doctorIds === null) return inClinic;
    return doctorIds.length
      ? and(inClinic, inArray(P.doctorId, doctorIds))!
      : sql`false`;
  }

  static async list(clinicId: string, actor: Actor, query: PlanListQuery) {
    const {
      patientId,
      status,
      stage,
      q,
      sortBy,
      sortOrder,
      pageNumber,
      pageSize,
    } = query;
    const [visible, matchedPatients] = await Promise.all([
      this.visible(clinicId, actor),
      // ponytail: name search takes the first 200 matching patients; join users if clinics outgrow it.
      q ? getPatientPort().searchIds(clinicId, q, 200) : Promise.resolve([]),
    ]);
    const filters: SQL[] = [visible, onePerProposal];
    if (patientId) filters.push(eq(P.patientId, patientId));
    if (status) filters.push(eq(P.status, status));
    // Step 1 is bookable as soon as the plan is accepted, whether or not its day was stored then.
    if (stage === 'needs_booking')
      filters.push(
        inArray(P.status, ['accepted', 'in_treatment']),
        sql`exists (select 1 from ${PlanStep} s where s.plan_id = ${P}.id and s.status = 'pending' and (s.seq = 1 or s.earliest_date is not null) and not exists (select 1 from ${Link} l where l.step_id = s.id and l.unlinked_at is null))`
      );
    if (stage === 'active')
      filters.push(inArray(P.status, ['accepted', 'in_treatment']));
    if (stage === 'stalled') filters.push(stalledSql);
    if (stage === 'payment_due') filters.push(sql`${dueSql} > 0`);
    // Finished plans whose check-up reminder is overdue or within a week (IST day): someone should call.
    if (stage === 'checkup_due')
      filters.push(
        eq(P.status, 'completed'),
        lte(P.recallDate, addDays(getISTDateString(), 7))
      );
    if (stage === 'missed')
      filters.push(
        sql`exists (select 1 from ${PlanStep} s where s.plan_id = ${P}.id and s.status = 'missed')`
      );
    if (q) {
      const byTitle = ilike(P.title, `%${escapeLike(q)}%`);
      filters.push(
        matchedPatients.length
          ? or(byTitle, inArray(P.patientId, matchedPatients))!
          : byTitle
      );
    }
    const where = and(...filters);
    const sortColumn = sortBy === 'totalAmount' ? P.totalAmount : P.createdAt;
    const order = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const [rows, [count], statusRows] = await Promise.all([
      database
        .select({
          id: P.id,
          title: P.title,
          patientId: P.patientId,
          doctorId: P.doctorId,
          status: P.status,
          planType: P.planType,
          optionLabel: P.optionLabel,
          optionName: P.optionName,
          packageExpiresOn: P.packageExpiresOn,
          stalled: stalledSql,
          duePaise: dueSql,
          leftPaise: leftToPaySql,
          optionCount: sql<number>`${groupOptions('count(*)::int')}`,
          minTotal: sql<string>`${groupOptions('min(o.total_amount)::text')}`,
          maxTotal: sql<string>`${groupOptions('max(o.total_amount)::text')}`,
          totalAmount: P.totalAmount,
          followUpDate: P.followUpDate,
          createdAt: P.createdAt,
          stepsTotal,
          stepsDone,
        })
        .from(P)
        .where(where)
        .orderBy(order, desc(P.id))
        .limit(pageSize)
        .offset((pageNumber - 1) * pageSize),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(P)
        .where(where),
      // Tab counts (6.6): every plan the caller may see, per status, ignoring the other filters.
      database
        .select({ status: P.status, total: sql<number>`count(*)::int` })
        .from(P)
        .where(and(visible, onePerProposal))
        .groupBy(P.status),
    ]);
    const counts = Object.fromEntries(
      statusRows.map((r) => [r.status, r.total])
    ) as Partial<Record<TreatmentPlan['status'], number>>;
    const ids = [...new Set(rows.map((r) => r.patientId))];
    const [names, mobiles] = await Promise.all([
      getPatientPort().getNames(ids),
      getPatientPort().getMobiles(clinicId, ids),
    ]);
    const items: PlanListItem[] = rows.map(
      ({ duePaise: _d, leftPaise: _l, ...r }) => ({
        ...r,
        due: fromPaise(Number(_d)),
        leftToPay: fromPaise(Number(_l)),
        patientName: names.get(r.patientId) ?? 'Patient',
        patientMobile: mobiles.get(r.patientId) ?? null,
      })
    );
    return { items, total: count?.total ?? 0, pageNumber, pageSize, counts };
  }

  static async get(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<PlanDetail> {
    const [row] = await database
      .select()
      .from(P)
      .where(and(eq(P.id, planId), await this.visible(clinicId, actor)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    return this.toDetail(row);
  }

  /** Runs before the consent upload: 404 unless the caller may see the plan, 409 when it can take no
   *  answer, so no file is uploaded for a save that can't happen. Accepted still passes: a retried
   *  accept must reach the service to get its first result (requestId). One indexed read. */
  static async assertAnswerable(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<void> {
    const [row] = await database
      .select({ status: P.status })
      .from(P)
      .where(and(eq(P.id, planId), await this.visible(clinicId, actor)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    // Declined passes too: it can still be accepted; the decision service decides per answer.
    if (!['proposed', 'accepted', 'declined'].includes(row.status))
      throw new HttpError(
        409,
        'The patient has already answered this plan. Reload to see it.'
      );
  }

  /** Signed consent forms on this patient's plans the actor may see, newest first. */
  static async consentForms(
    clinicId: string,
    actor: Actor,
    patientId: string
  ): Promise<PlanConsentForm[]> {
    return database
      .select({
        planId: P.id,
        title: P.title,
        optionLabel: P.optionLabel,
        doctorId: P.doctorId,
        acceptedAt: P.acceptedAt,
      })
      .from(P)
      .where(
        and(
          await this.visible(clinicId, actor),
          eq(P.patientId, patientId),
          isNotNull(P.consentFileUrl)
        )
      )
      .orderBy(desc(P.acceptedAt));
  }

  /** Stored key of a plan's consent form the actor may see; the files module signs it. */
  static async consentLocation(
    planId: string,
    clinicId: string,
    actor: Actor
  ): Promise<string | null> {
    const [row] = await database
      .select({ location: P.consentFileUrl })
      .from(P)
      .where(and(eq(P.id, planId), await this.visible(clinicId, actor)))
      .limit(1);
    return row?.location ?? null;
  }

  /** A 5-minute link to the signed consent form, fetched when staff click "View consent". */
  static async consentFileLink(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<{ url: string }> {
    const [row] = await database
      .select({ consentFileUrl: P.consentFileUrl })
      .from(P)
      .where(and(eq(P.id, planId), await this.visible(clinicId, actor)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    const url = row.consentFileUrl
      ? await getFilePort().signDocument(row.consentFileUrl)
      : null;
    if (!url)
      throw new HttpError(404, 'No consent form is on file for this plan');
    return { url };
  }

  /** Detail from a row the caller already holds; steps are read only when not passed in. */
  static async toDetail(
    row: TreatmentPlan,
    knownSteps?: TreatmentPlanStep[]
  ): Promise<PlanDetail> {
    // A version and an advance exist only once the plan is accepted, so a proposed plan skips both reads.
    const accepted = !!row.acceptedAt;
    const [
      steps,
      patient,
      options,
      [version],
      ledger,
      callRows,
      links,
      instalments,
      historyRows,
    ] = await Promise.all([
      knownSteps ??
        database
          .select()
          .from(PlanStep)
          .where(eq(PlanStep.planId, row.id))
          .orderBy(asc(PlanStep.seq)),
      getPatientPort().getClinicPatient(row.clinicId, row.patientId),
      database
        .select({
          id: P.id,
          optionLabel: P.optionLabel,
          optionName: P.optionName,
          status: P.status,
          totalAmount: P.totalAmount,
        })
        .from(P)
        .where(
          and(
            eq(P.clinicId, row.clinicId),
            eq(P.proposalGroupId, row.proposalGroupId)
          )
        )
        .orderBy(asc(P.optionLabel)),
      accepted
        ? database
            .select({
              version: Version.version,
              needsPatientApproval: Version.needsPatientApproval,
              patientApprovedAt: Version.patientApprovedAt,
            })
            .from(Version)
            .where(eq(Version.planId, row.id))
            .orderBy(desc(Version.version))
            .limit(1)
        : [],
      // The plan's money from the clinic ledger, in the shape the plan screens read (rupee strings).
      accepted
        ? PlanMoneyStore.entries(database, row.id).then((rows) =>
            rows.map((e) => ({
              id: e.id,
              type: e.entryType,
              amount: fromPaise(e.amountPaise),
              paymentMode: e.paymentMode,
              reason: e.reason,
              stepId: e.lineRef,
              receiptNo: e.receiptNo,
              reversesEntryId: e.reversesEntryId,
              createdAt: e.createdAt,
            }))
          )
        : [],
      database
        .select({
          id: History.id,
          outcome: History.toValue,
          notes: History.notes,
          meta: History.meta,
          actorId: History.actorId,
          createdAt: History.createdAt,
        })
        .from(History)
        .where(
          and(eq(History.planId, row.id), eq(History.action, 'follow_up_call'))
        )
        .orderBy(desc(History.createdAt))
        .limit(50),
      accepted
        ? database
            .select({
              stepId: Link.stepId,
              appointmentId: Link.appointmentId,
            })
            .from(Link)
            .where(and(eq(Link.planId, row.id), isNull(Link.unlinkedAt)))
        : [],
      accepted
        ? database
            .select({
              id: Instalment.id,
              seq: Instalment.seq,
              amount: Instalment.amount,
              dueDate: Instalment.dueDate,
              paidAt: Instalment.paidAt,
            })
            .from(Instalment)
            .where(eq(Instalment.planId, row.id))
            .orderBy(asc(Instalment.seq))
        : [],
      // Only the newest few: the card loads the rest through GET /:planId/history on "Show all".
      this.historyPage(row.id, DETAIL_HISTORY, 0),
    ]);
    // Second round: booked visits' dates live in appointments; the doctor's name for the header.
    const [visits, doctorNames, consultationPaise] = await Promise.all([
      links.length
        ? getAppointmentPort().getAppointments(
            row.clinicId,
            links.map((l) => l.appointmentId)
          )
        : new Map<string, PlanAppointment>(),
      getPatientPort().getNames([row.doctorId]),
      // Accept shows it, so the desk payment is not entered again as an advance.
      !accepted && row.consultationAppointmentId && row.consultationStepSeq
        ? getAppointmentPort().receivedOnVisitPaise(
            row.consultationAppointmentId
          )
        : Promise.resolve(null),
    ]);
    const bookingByStep = new Map(
      links.flatMap((l) => {
        const v = visits.get(l.appointmentId);
        return v ? [[l.stepId, v] as const] : [];
      })
    );
    // Worked out on read with the §5 rule, not trusted from the stored column: a plan accepted
    // before that column was filled (or edited since) still shows the right days.
    const earliest = row.acceptedAt
      ? earliestDates(
          getISTDateString(row.acceptedAt),
          steps.map((s) => ({
            gapDays: s.gapDays,
            status: s.status,
            doneOn: s.doneAt ? getISTDateString(s.doneAt) : null,
            bookedOn: bookingByStep.get(s.id)?.date ?? null,
          }))
        )
      : steps.map((s) => s.earliestDate);
    const lateAfter = row.acceptedAt
      ? lateAfterDates(
          getISTDateString(row.acceptedAt),
          steps.map((s) => ({
            gapDays: s.gapDays,
            maxGapDays: s.maxGapDays,
            status: s.status,
            doneOn: s.doneAt ? getISTDateString(s.doneAt) : null,
            bookedOn: bookingByStep.get(s.id)?.date ?? null,
          }))
        )
      : steps.map(() => null);
    const today = getISTDateString();
    const advance = ledger.find((e) => e.type === 'advance');
    const sums: Record<string, number> = {};
    for (const e of ledger) {
      // An adjustment undoes part of its target, so it counts against the target's type (as PlanMoneyStore.sums).
      const target =
        e.type === 'adjustment' && e.reversesEntryId
          ? ledger.find((t) => t.id === e.reversesEntryId)
          : null;
      const type = target ? target.type : e.type;
      sums[type] = (sums[type] ?? 0) + (target ? -1 : 1) * toPaise(e.amount);
    }
    const balance = planBalance(toPaise(row.totalAmount), sums);
    // Pay-at-each-visit: what the next visit costs (its share less unused credit), same rule as the visit page.
    let nextVisit: { stepId: string; fee: string } | null = null;
    // The next open step's share in any billing mode: Mark done charges it, and a package step's own fee is 0.
    let nextShare: PlanDetail['nextShare'] = null;
    const paymentByStep = new Map<string, PlanStepPayment>();
    {
      const charged = new Set(
        ledger.filter((e) => e.type === 'charge').map((e) => e.stepId)
      );
      const fee = (s: (typeof steps)[number]) =>
        toPaise(s.fee) + toPaise(s.selectedOption?.extraFee ?? 0);
      const uncharged = steps.filter(
        (s) => !charged.has(s.id) && s.status !== 'skipped'
      );
      const next = uncharged.find(
        (s) => s.status === 'pending' || s.status === 'missed'
      );
      if (next) {
        const share = stepChargePaise({
          totalPaise: toPaise(row.totalAmount),
          chargedPaise: sums.charge ?? 0,
          feePaise: fee(next),
          unchargedFeesPaise: uncharged.reduce((n, s) => n + fee(s), 0),
          unchargedCount: uncharged.length,
        });
        // The whole "collect now" sum, so screens show it and never work money out themselves.
        const c = collectNow(balance, share);
        nextShare = {
          stepId: next.id,
          amount: fromPaise(c.sharePaise),
          priorDue: fromPaise(c.priorDuePaise),
          fromAdvance: fromPaise(c.fromAdvancePaise),
          toCollect: fromPaise(c.toCollectPaise),
        };
        if (['per_visit', 'advance_per_visit'].includes(row.billingMode ?? ''))
          nextVisit = {
            stepId: next.id,
            fee: fromPaise(Math.max(0, share - Math.max(0, -balance.due))),
          };
      }
      // Each step's paid status: money paid (and written off) covers charged steps first, then the rest in order.
      // Charged steps use their charge; steps still to come use their share, so money paid early shows as "paid ahead".
      if (accepted) {
        const chargeOf = new Map<string, number>();
        for (const e of ledger)
          if (e.type === 'charge' && e.stepId)
            chargeOf.set(
              e.stepId,
              (chargeOf.get(e.stepId) ?? 0) + toPaise(e.amount)
            );
        let pool = Math.max(0, balance.paid + balance.writtenOff);
        // Charged steps first (steps can be done out of order), then the rest by seq.
        const order = [...steps].sort(
          (a, b) =>
            Number(chargeOf.has(b.id)) - Number(chargeOf.has(a.id)) ||
            a.seq - b.seq
        );
        for (const s of order) {
          if (s.status === 'skipped') continue;
          const isCharged = chargeOf.has(s.id);
          const cost = isCharged
            ? chargeOf.get(s.id)!
            : stepChargePaise({
                totalPaise: toPaise(row.totalAmount),
                chargedPaise: sums.charge ?? 0,
                feePaise: fee(s),
                unchargedFeesPaise: uncharged.reduce((n, x) => n + fee(x), 0),
                unchargedCount: uncharged.length,
              });
          const covered = Math.min(pool, cost);
          pool -= covered;
          paymentByStep.set(s.id, {
            status: isCharged
              ? covered >= cost
                ? 'paid'
                : 'due'
              : covered >= cost && cost > 0
                ? 'paid_ahead'
                : covered > 0
                  ? 'part_ahead'
                  : 'unpaid',
            paid: fromPaise(covered),
            due: fromPaise(isCharged ? cost - covered : 0),
          });
        }
      }
    }
    const { clinicId: _clinicId, consentFileUrl, ...plan } = row;
    return {
      ...plan,
      hasConsentFile: !!consentFileUrl,
      consultationPaid:
        consultationPaise === null ? null : fromPaise(consultationPaise),
      doctor: {
        id: row.doctorId,
        name: doctorNames.get(row.doctorId) ?? 'Doctor',
      },
      version: version ?? null,
      advance: advance
        ? {
            amount: advance.amount,
            paymentMode: advance.paymentMode,
            receiptNo: advance.receiptNo,
            createdAt: advance.createdAt,
          }
        : null,
      // Where the money stands (Phase 5); all zero until the plan is accepted.
      money: {
        charged: fromPaise(balance.charged),
        paid: fromPaise(balance.paid),
        due: fromPaise(balance.due),
        toCome: fromPaise(balance.toCome),
        leftToPay: fromPaise(balance.leftToPay),
        writtenOff: fromPaise(balance.writtenOff),
        refunded: fromPaise(balance.refunded),
        entries: ledger.map((e) => ({
          ...e,
          receiptNo: ['advance', 'payment', 'refund'].includes(e.type)
            ? e.receiptNo
            : null,
        })),
        instalments,
      },
      history: historyRows.items,
      historyTotal: historyRows.total,
      calls: callRows.map(({ meta, ...c }) => ({
        ...c,
        nextFollowUpDate:
          (meta as HistoryMetaByAction['follow_up_call'] | null)
            ?.nextFollowUpDate ?? null,
      })),
      steps: steps.map((s, i) => {
        const v = bookingByStep.get(s.id);
        const earliestDate = earliest[i];
        const lateDay = lateAfter[i];
        const visitDay = s.doneAt
          ? getISTDateString(s.doneAt)
          : (v?.date ?? null);
        return {
          id: s.id,
          seq: s.seq,
          name: s.name,
          gapDays: s.gapDays,
          maxGapDays: s.maxGapDays,
          lateAfterDate: lateDay,
          // Late: its visit is past the limit (booking still allowed). Overdue: no visit and the limit has passed.
          lateness:
            !lateDay || s.status === 'skipped'
              ? null
              : visitDay
                ? visitDay > lateDay
                  ? 'late'
                  : null
                : today > lateDay
                  ? 'overdue'
                  : null,
          durationMinutes: s.durationMinutes,
          fee: s.fee,
          selectedOption: s.selectedOption,
          specialtyData: s.specialtyData,
          status: s.status,
          earliestDate,
          gapOverrideReason: s.gapOverrideReason,
          notes: s.notes,
          doneAt: s.doneAt,
          payment: paymentByStep.get(s.id) ?? null,
          booking: v
            ? {
                appointmentId: v.id,
                date: v.date,
                time: v.time,
                tokenNo: v.tokenNo,
                status: v.status,
                isPlanVisit: v.isPlanVisit,
              }
            : null,
          // Booked, but an earlier step lost its visit (no earliest day), or an earlier step moved
          // so this visit is now before its earliest day with no reason given.
          // A done or skipped step's visit already happened; it can't be rebooked.
          needsRebooking:
            !!v &&
            s.status !== 'done' &&
            s.status !== 'skipped' &&
            (!earliestDate || (v.date < earliestDate && !s.gapOverrideReason)),
        };
      }),
      patient: patient ?? { id: row.patientId, name: 'Patient', allergies: [] },
      options,
      todayVisit: await this.todayVisitForStep1(row, steps, bookingByStep),
      nextVisit,
      nextShare,
    };
  }

  /** Step 1 still has no visit: today's visit with the plan's doctor, if no step uses it yet. */
  private static async todayVisitForStep1(
    row: TreatmentPlan,
    steps: TreatmentPlanStep[],
    bookingByStep: Map<string, unknown>
  ) {
    const first = steps.find((s) => s.seq === 1);
    if (
      !['accepted', 'in_treatment'].includes(row.status) ||
      !first ||
      !['pending', 'missed'].includes(first.status) ||
      bookingByStep.has(first.id)
    )
      return null;
    const visit = await getAppointmentPort().todayForPatient(
      row.clinicId,
      row.patientId,
      row.doctorId,
      getISTDateString()
    );
    if (!visit) return null;
    const [used] = await database
      .select({ id: Link.id })
      .from(Link)
      .where(and(eq(Link.appointmentId, visit.id), isNull(Link.unlinkedAt)))
      .limit(1);
    return used ? null : visit;
  }

  /** GET /:planId/history: one page of the plan's history, newest first ("Show all" on the card). */
  static async history(
    clinicId: string,
    actor: Actor,
    planId: string,
    pageNumber: number,
    pageSize: number
  ) {
    const [row] = await database
      .select({ id: P.id })
      .from(P)
      .where(and(eq(P.id, planId), await this.visible(clinicId, actor)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    const page = await this.historyPage(
      planId,
      pageSize,
      (pageNumber - 1) * pageSize
    );
    return { ...page, pageNumber, pageSize };
  }

  /** History rows with who did them (null actor = the system), plus the full count. */
  private static async historyPage(
    planId: string,
    limit: number,
    offset: number
  ) {
    const [rows, [count]] = await Promise.all([
      database
        .select({
          id: History.id,
          action: History.action,
          fromValue: History.fromValue,
          toValue: History.toValue,
          reason: History.reason,
          notes: History.notes,
          stepId: sql<string | null>`${History.meta}->>'stepId'`,
          amount: sql<string | null>`${History.meta}->>'amount'`,
          actorId: History.actorId,
          createdAt: History.createdAt,
        })
        .from(History)
        .where(eq(History.planId, planId))
        .orderBy(desc(History.createdAt), desc(History.id))
        .limit(limit)
        .offset(offset),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(History)
        .where(eq(History.planId, planId)),
    ]);
    // getNames reads any user, staff included.
    const names = await getPatientPort().getNames([
      ...new Set(rows.flatMap((h) => (h.actorId ? [h.actorId] : []))),
    ]);
    return {
      items: rows.map(({ actorId, ...h }) => ({
        ...h,
        actorName: actorId ? (names.get(actorId) ?? null) : null,
      })),
      total: count?.total ?? 0,
    };
  }

  /** Name and recorded allergies for the create-plan screen; 404 unless the patient is in the clinic. */
  static async patientContext(clinicId: string, patientId: string) {
    const patient = await getPatientPort().getClinicPatient(
      clinicId,
      patientId
    );
    if (!patient) throw new HttpError(404, 'Patient not found');
    return patient;
  }

  /** Best template matches for a diagnosis, among the templates this doctor may use (2.1). */
  static async suggestions(
    clinicId: string,
    doctorId: string,
    diagnosis: string
  ): Promise<PlanSuggestion[]> {
    const available = await TemplateQueryService.availableForDoctor(
      clinicId,
      doctorId
    );
    return matchTemplates(diagnosis, available).map(
      ({ template, matchedKeyword }) => ({
        templateId: template.id,
        name: template.name,
        planType: template.planType,
        matchedKeyword,
        isOwnVersion: template.ownerDoctorId !== null,
        stepCount:
          template.planType === 'package' || template.planType === 'review'
            ? (template.sessionCount ?? 0)
            : template.stepCount,
        price:
          template.pricingMode === 'package'
            ? template.packagePrice
            : template.stepsFeeTotal,
      })
    );
  }
}
