import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import redisClient from '../../../../configurations/redisConfig';
import logger from '../../../../utils/logger';
import { findSpecialtyGroup } from '../../../../utils/specialtyCatalog';
import { HttpError } from '../../../../middlewear/errorHandler';
import {
  TreatmentPlanModel as P,
  TreatmentPlanStepModel as PlanStep,
  TreatmentStepAppointmentModel as Link,
  TreatmentPlanVersionModel as Version,
  type TreatmentPlan,
  type TreatmentPlanStep,
} from '../../models/treatmentPlan.model';
import { TreatmentPlanHistoryModel as History } from '../../models/treatmentPlanHistory.model';
import { getAppointmentPort, getDoctorPort, getPatientPort } from '../../ports';
import type {
  PlanCreate,
  PlanStepInput,
  PlanUpdate,
} from '../../schemas/plan.schema';
import { templateCreateSchema } from '../../schemas/template.schema';
import type { PlanDetail } from '../../types/plan.types';
import type { Actor, TemplateDetail } from '../../types/template.types';
import { fromPaise, toPaise } from '../../utils/money.utils';
import {
  planBasePaise,
  safetyIssues,
  type SafetyIssue,
} from '../../utils/planRules.utils';
import { snapshotOf } from '../../utils/snapshot.utils';
import { buildSpecialtyDataSchema } from '../../utils/specialtyFields.utils';
import { TreatmentHistoryService } from '../history.service';
import { TreatmentPlanSettingsService } from '../settings.service';
import { SpecialtyConfigService } from '../specialtyConfig.service';
import { TemplateQueryService } from '../templates/templateQuery.service';
import { TemplateWriteService } from '../templates/templateWrite.service';
import { PlanQueryService, hasPlansKey } from './planQuery.service';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type PlanInput = Omit<PlanUpdate, 'updatedAt'>;

// Plans still open for the patient; a second one for the same treatment needs a reason.
const OPEN_STATUSES = [
  'proposed',
  'accepted',
  'in_treatment',
  'paused',
] as const;
const MAX_OPTIONS = 3;
// Before treatment starts; after accept an edit becomes a new version (DEV_PLAN 3.3).
const EDITABLE = ['proposed', 'accepted'] as const;
// A change to these needs the patient's yes again.
const NEEDS_APPROVAL = new Set(['totalAmount', 'discountAmount', 'steps']);
const REASON_FOR: Record<SafetyIssue['kind'], keyof PlanInput['overrides']> = {
  gap: 'gapReason',
  discount: 'discountReason',
  duplicate: 'duplicateReason',
};

export class PlanWriteService {
  /** A proposed plan for a patient of this clinic, from a template (steps copied) or custom (2.2). */
  static async create(
    clinicId: string,
    actor: Actor,
    body: PlanCreate
  ): Promise<PlanDetail> {
    const patient = await getPatientPort().getClinicPatient(
      clinicId,
      body.patientId
    );
    if (!patient) throw new HttpError(404, 'Patient not found');
    if (body.appointmentId) {
      const appt = await getAppointmentPort().getAppointment(
        clinicId,
        body.appointmentId
      );
      if (!appt) throw new HttpError(404, 'Appointment not found');
      if (appt.patientId !== body.patientId)
        throw new HttpError(
          422,
          'That consultation belongs to another patient'
        );
    }
    const template = body.templateId
      ? await TemplateQueryService.get({ clinicId }, actor, body.templateId)
      : null;
    if (template && template.status !== 'active')
      throw new HttpError(422, 'Choose an active template');
    // A catalogue start is not stored as the plan's template (that is clinic-owned); history keeps it.
    const library =
      !template && body.libraryTemplateId
        ? await TemplateQueryService.libraryTemplateForClinic(
            body.libraryTemplateId
          )
        : null;

    const checked = await this.check(
      clinicId,
      body,
      template ?? library,
      body.patientId,
      []
    );
    const { plan, steps } = await database.transaction(async (tx) => {
      const [plan] = await tx
        .insert(P)
        .values({
          ...this.columns(body, checked.totalPaise),
          clinicId,
          patientId: body.patientId,
          doctorId: actor.id,
          templateId: template?.id ?? null,
          instalmentsAllowed: (template ?? library)?.instalmentsAllowed ?? true,
          recallAfterDays: (template ?? library)?.recallAfterDays ?? null,
          consultationAppointmentId: body.appointmentId ?? null,
          consultationStepSeq: body.appointmentId
            ? (body.consultationStepSeq ?? null)
            : null,
          proposalGroupId: randomUUID(),
          createdBy: actor.id,
        })
        .returning();
      const steps = await this.insertSteps(
        tx,
        plan,
        body.steps,
        checked.issues,
        body.overrides
      );
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'plan_created',
        meta: template
          ? { templateId: template.id }
          : library
            ? { libraryTemplateId: library.id }
            : {},
      });
      await this.recordOverrides(
        tx,
        plan,
        actor,
        steps,
        checked,
        body.overrides
      );
      return { plan, steps };
    });
    // The clinic now has plans: the dashboard card starts counting them.
    await redisClient
      .set(hasPlansKey(clinicId), '1')
      .catch((err) =>
        logger.warn('[TreatmentPlan] has-plans flag set failed', err)
      );
    return PlanQueryService.toDetail(plan, steps);
  }

  /** Edits a proposed or accepted plan in full: fields and the whole step list (2.3, 3.3). Steps are replaced, so a
   *  reorder never meets the unique (plan_id, seq) index. 409 when someone else saved first (P10). */
  static async update(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: PlanUpdate
  ): Promise<PlanDetail> {
    const current = await this.loadOwn(clinicId, actor, planId, EDITABLE);
    if (current.optionLabel && !(body.optionName ?? current.optionName))
      throw new HttpError(
        422,
        'Name this option, e.g. Ceramic crown, so the patient can tell the options apart'
      );
    const template = current.templateId
      ? await TemplateQueryService.get(
          { clinicId },
          actor,
          current.templateId
        ).catch(() => null)
      : null;
    const checked = await this.check(
      clinicId,
      body,
      template,
      current.patientId,
      [current.proposalGroupId]
    );

    const { plan, steps } = await database.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(P)
        .where(eq(P.id, planId))
        .for('update');
      if (
        locked.updatedAt.toISOString() !==
        new Date(body.updatedAt).toISOString()
      )
        throw new HttpError(
          409,
          'This plan was changed by someone else. Reload to see the latest.'
        );
      // ponytail: steps are replaced on save, which a booked or finished step can't survive;
      // editing mid-booking needs in-place step updates (a later phase).
      if (locked.status === 'accepted') {
        const [inUse] = await tx
          .select({ id: Link.id })
          .from(Link)
          .where(and(eq(Link.planId, planId), isNull(Link.unlinkedAt)))
          .limit(1);
        if (inUse)
          throw new HttpError(
            409,
            'Some steps already have booked visits. Unlink them on the plan page before changing the steps.'
          );
      }
      if (
        locked.status === 'accepted' &&
        checked.totalPaise < toPaise(locked.advanceAmount)
      )
        throw new HttpError(
          422,
          'The new total is less than the advance already paid'
        );
      const [plan] = await tx
        .update(P)
        .set(this.columns(body, checked.totalPaise))
        .where(eq(P.id, planId))
        .returning();
      const oldSteps = await tx
        .select()
        .from(PlanStep)
        .where(eq(PlanStep.planId, planId));
      await tx.delete(PlanStep).where(eq(PlanStep.planId, planId));
      const steps = await this.insertSteps(
        tx,
        plan,
        body.steps,
        checked.issues,
        body.overrides
      );
      const changed = changedFields(locked, plan, oldSteps, steps);
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId,
        actorId: actor.id,
        action: 'plan_edit',
        meta: { changedFields: changed },
      });
      // After accept, a real change is a new immutable version; v1 and earlier stay as they were.
      if (locked.status === 'accepted' && changed.length) {
        const [latest] = await tx
          .select({ version: Version.version })
          .from(Version)
          .where(eq(Version.planId, planId))
          .orderBy(desc(Version.version))
          .limit(1);
        const version = (latest?.version ?? 0) + 1;
        const needsPatientApproval = changed.some((f) => NEEDS_APPROVAL.has(f));
        await tx.insert(Version).values({
          clinicId,
          planId,
          version,
          snapshot: snapshotOf(plan, steps),
          needsPatientApproval,
          createdBy: actor.id,
        });
        await TreatmentHistoryService.record(tx, {
          clinicId,
          planId,
          actorId: actor.id,
          action: 'version_created',
          fromValue: String(version - 1),
          toValue: String(version),
          meta: { version, needsPatientApproval },
        });
      }
      await this.recordOverrides(
        tx,
        plan,
        actor,
        steps,
        checked,
        body.overrides
      );
      return { plan, steps };
    });
    return PlanQueryService.toDetail(plan, steps);
  }

  /** Copies a proposed plan as the next option (A → B → C) in the same proposal group (P6). */
  static async addOption(
    clinicId: string,
    actor: Actor,
    planId: string,
    body: { name: string; sourceName?: string }
  ): Promise<PlanDetail> {
    const source = await this.loadOwn(clinicId, actor, planId, ['proposed']);
    if (!source.optionName && !body.sourceName)
      throw new HttpError(
        422,
        'Name the current option too, so the patient can tell them apart'
      );
    const { plan, steps } = await database.transaction(async (tx) => {
      const group = await tx
        .select({ id: P.id, optionLabel: P.optionLabel })
        .from(P)
        .where(
          and(
            eq(P.clinicId, clinicId),
            eq(P.proposalGroupId, source.proposalGroupId)
          )
        )
        .for('update');
      if (group.length >= MAX_OPTIONS)
        throw new HttpError(
          409,
          `A proposal can have up to ${MAX_OPTIONS} options`
        );
      // The first option becomes "A" once a second one exists, and gets its name.
      if (!source.optionLabel || body.sourceName)
        await tx
          .update(P)
          .set({
            optionLabel: source.optionLabel ?? 'A',
            ...(body.sourceName ? { optionName: body.sourceName } : {}),
          })
          .where(eq(P.id, source.id));
      // After the highest letter in use, so a removed option never leaves two with the same letter.
      const used = group.map((g) => g.optionLabel ?? 'A').sort();
      const label = String.fromCharCode(
        used[used.length - 1].charCodeAt(0) + 1
      );

      const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = source;
      const [plan] = await tx
        .insert(P)
        .values({
          ...fields,
          optionLabel: label,
          optionName: body.name,
          status: 'proposed',
          createdBy: actor.id,
        })
        .returning();
      const sourceSteps = await tx
        .select()
        .from(PlanStep)
        .where(eq(PlanStep.planId, source.id))
        .orderBy(PlanStep.seq);
      const steps = sourceSteps.length
        ? await tx
            .insert(PlanStep)
            .values(
              sourceSteps.map(
                ({ id: _sid, createdAt: _sc, updatedAt: _su, ...s }) => ({
                  ...s,
                  planId: plan.id,
                })
              )
            )
            .returning()
        : [];
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: plan.id,
        actorId: actor.id,
        action: 'option_added',
        meta: { sourcePlanId: source.id, optionLabel: label },
      });
      return { plan, steps: steps.sort((a, b) => a.seq - b.seq) };
    });
    return PlanQueryService.toDetail(plan, steps);
  }

  /** Removes a suggested option (never the last one): nothing was agreed, booked or paid on it. */
  static async removeOption(
    clinicId: string,
    actor: Actor,
    planId: string
  ): Promise<{ remainingPlanId: string }> {
    const option = await this.loadOwn(clinicId, actor, planId, ['proposed']);
    return database.transaction(async (tx) => {
      const others = await tx
        .select({ id: P.id, optionLabel: P.optionLabel, status: P.status })
        .from(P)
        .where(
          and(
            eq(P.clinicId, clinicId),
            eq(P.proposalGroupId, option.proposalGroupId),
            ne(P.id, option.id)
          )
        )
        .orderBy(P.optionLabel)
        .for('update');
      if (!others.length)
        throw new HttpError(
          409,
          'This is the only option. Decline the plan instead.'
        );
      await tx.delete(History).where(eq(History.planId, option.id));
      await tx.delete(PlanStep).where(eq(PlanStep.planId, option.id));
      await tx.delete(P).where(eq(P.id, option.id));
      // A single option left is an ordinary plan again: no letter, no name needed.
      if (others.length === 1)
        await tx
          .update(P)
          .set({ optionLabel: null, optionName: null })
          .where(eq(P.id, others[0].id));
      await TreatmentHistoryService.record(tx, {
        clinicId,
        planId: others[0].id,
        actorId: actor.id,
        action: 'option_removed',
        meta: {
          optionLabel: option.optionLabel,
          optionName: option.optionName,
        },
      });
      return { remainingPlanId: others[0].id };
    });
  }

  /** Turns a plan into the doctor's own template, linked to the template it came from (V5). */
  static async saveAsTemplate(
    clinicId: string,
    actor: Actor,
    planId: string,
    name: string
  ): Promise<TemplateDetail> {
    const plan = await PlanQueryService.get(clinicId, actor, planId);
    if (plan.doctorId !== actor.id)
      throw new HttpError(404, 'Treatment plan not found');
    const source = plan.templateId
      ? await TemplateQueryService.get(
          { clinicId },
          actor,
          plan.templateId
        ).catch(() => null)
      : null;
    const specialty =
      source?.specialty ??
      (await getDoctorPort().getSpecialties(actor.id)).find((s) =>
        findSpecialtyGroup(s)
      );
    if (!specialty)
      throw new HttpError(
        422,
        'Add your speciality to your profile before saving templates'
      );

    // A plan with no step fees and a price was priced as a package.
    const stepFees = plan.steps.reduce((sum, s) => sum + toPaise(s.fee), 0);
    const listPrice = fromPaise(
      toPaise(plan.totalAmount) + toPaise(plan.discountAmount)
    );
    const isPackage = plan.planType === 'package';
    const isReview = plan.planType === 'review';
    const repeats = isPackage || isReview;
    // A review template keeps one review (name + fee), repeated by the count (Q28).
    const review = plan.steps[0];
    const parsed = templateCreateSchema.safeParse({
      name,
      specialty,
      planType: plan.planType,
      pricingMode:
        !isReview && (isPackage || stepFees === 0) ? 'package' : 'per_step',
      packagePrice:
        !isReview && (isPackage || stepFees === 0) ? listPrice : null,
      sessionCount: repeats ? plan.steps.length : null,
      intervalDays: repeats ? Math.max(1, plan.steps[1]?.gapDays ?? 1) : null,
      packageExpiryDays: isPackage ? plan.packageExpiryDays : null,
      consentRequired: plan.consentRequired,
      instalmentsAllowed: isPackage && plan.instalmentsAllowed,
      recallAfterDays: plan.recallAfterDays ?? undefined,
      diagnosisKeywords: source?.diagnosisKeywords ?? [],
      steps: isPackage
        ? []
        : isReview
          ? [
              {
                name: review?.name.replace(/\s+\d+$/, '') || 'Review',
                gapDays: 0,
                durationMinutes: review?.durationMinutes,
                fee: review?.fee,
                options: [],
              },
            ]
          : plan.steps.map((s) => ({
              name: s.name,
              gapDays: s.gapDays,
              maxGapDays: s.maxGapDays,
              durationMinutes: s.durationMinutes,
              fee: s.fee,
              options: s.selectedOption ? [s.selectedOption] : [],
            })),
      ownVersion: true,
    });
    if (!parsed.success)
      throw new HttpError(
        422,
        parsed.error.issues[0]?.message ?? 'This plan cannot be a template'
      );
    return TemplateWriteService.create(
      { clinicId },
      actor,
      parsed.data,
      plan.templateId ?? null
    );
  }

  /** Validates prices and specialty values, then lists the checks that need a reason (2.4).
   *  Throws 422 REASON_REQUIRED with the issues when a needed reason is missing. */
  private static async check(
    clinicId: string,
    body: PlanInput,
    template: TemplateDetail | null,
    patientId: string,
    sameGroupIds: string[]
  ) {
    if (body.pricingMode === 'package' && body.packagePrice == null)
      throw new HttpError(422, 'Enter the package price');
    const basePaise = planBasePaise(
      body.pricingMode,
      body.steps,
      body.packagePrice
    );
    const discountPaise = toPaise(body.discountAmount);
    if (discountPaise > basePaise)
      throw new HttpError(422, 'The discount is more than the plan price');

    await this.checkSpecialtyData(
      clinicId,
      template?.specialty ?? body.specialty,
      body
    );

    const [settings, openPlans] = await Promise.all([
      TreatmentPlanSettingsService.get(clinicId),
      database
        .select({ id: P.id })
        .from(P)
        .where(
          and(
            eq(P.clinicId, clinicId),
            eq(P.patientId, patientId),
            inArray(P.status, [...OPEN_STATUSES]),
            template
              ? eq(P.templateId, template.id)
              : sql`lower(${P.title}) = lower(${body.title})`,
            ...sameGroupIds.map((g) => ne(P.proposalGroupId, g))
          )
        )
        .limit(10),
    ]);

    const issues = safetyIssues({
      steps: body.steps,
      minGapByName:
        template?.planType === 'staged'
          ? new Map(
              template.steps.map((s) => [
                s.name.trim().toLowerCase(),
                s.gapDays,
              ])
            )
          : undefined,
      packageInterval:
        template?.planType === 'package' || template?.planType === 'review'
          ? template.intervalDays
          : null,
      basePaise,
      discountPaise,
      capPercent: settings.discountCapPercent,
      activePlanIds: openPlans.map((p) => p.id),
    });
    const missing = issues.filter((i) => !body.overrides[REASON_FOR[i.kind]]);
    if (missing.length)
      throw new HttpError(422, 'Some checks need a reason before saving', {
        code: 'REASON_REQUIRED',
        issues,
      });
    return {
      issues,
      totalPaise: basePaise - discountPaise,
      capPercent: settings.discountCapPercent,
      activePlanIds: openPlans.map((p) => p.id),
    };
  }

  /** Plan and step specialty values must match the specialty's field set; with none, they must be empty. */
  private static async checkSpecialtyData(
    clinicId: string,
    specialty: string | undefined,
    body: PlanInput
  ): Promise<void> {
    const config = specialty
      ? await SpecialtyConfigService.forClinic(clinicId, specialty)
      : null;
    const fail = (where: string, message?: string) => {
      throw new HttpError(
        422,
        `${where}: ${message ?? 'check the specialty fields'}`
      );
    };
    const plan = buildSpecialtyDataSchema(config?.planFields ?? []).safeParse(
      body.specialtyData
    );
    if (!plan.success) fail('Plan', plan.error.issues[0]?.message);
    const stepSchema = buildSpecialtyDataSchema(config?.stepFields ?? []);
    body.steps.forEach((s, i) => {
      const r = stepSchema.safeParse(s.specialtyData);
      if (!r.success) fail(`Step ${i + 1}`, r.error.issues[0]?.message);
    });
  }

  private static columns(body: PlanInput, totalPaise: number) {
    return {
      title: body.title,
      diagnosis: body.diagnosis,
      planType: body.planType,
      discountAmount: fromPaise(toPaise(body.discountAmount)),
      totalAmount: fromPaise(totalPaise),
      consentRequired: body.consentRequired,
      packageExpiryDays: body.packageExpiryDays ?? null,
      specialtyData: body.specialtyData,
      ...(body.optionName !== undefined ? { optionName: body.optionName } : {}),
    };
  }

  private static async insertSteps(
    tx: Tx,
    plan: TreatmentPlan,
    steps: PlanStepInput[],
    issues: SafetyIssue[],
    overrides: PlanInput['overrides']
  ): Promise<TreatmentPlanStep[]> {
    const gapSeqs = new Set(
      issues.filter((i) => i.kind === 'gap').map((i) => i.seq)
    );
    const rows = await tx
      .insert(PlanStep)
      .values(
        steps.map((s, i) => ({
          clinicId: plan.clinicId,
          planId: plan.id,
          seq: i + 1,
          name: s.name,
          gapDays: s.gapDays,
          // Below the gap it could never be met, so it's dropped rather than refused.
          maxGapDays:
            s.maxGapDays != null && s.maxGapDays >= s.gapDays
              ? s.maxGapDays
              : null,
          durationMinutes: s.durationMinutes ?? null,
          fee: fromPaise(toPaise(s.fee)),
          selectedOption: s.selectedOption ?? null,
          specialtyData: s.specialtyData,
          notes: s.notes ?? null,
          gapOverrideReason: gapSeqs.has(i + 1)
            ? (overrides.gapReason ?? null)
            : null,
        }))
      )
      .returning();
    return rows.sort((a, b) => a.seq - b.seq);
  }

  /** One history row per approved exception, with the reason given (§3.4). */
  private static async recordOverrides(
    tx: Tx,
    plan: TreatmentPlan,
    actor: Actor,
    steps: TreatmentPlanStep[],
    checked: {
      issues: SafetyIssue[];
      capPercent: number;
      activePlanIds: string[];
    },
    overrides: PlanInput['overrides']
  ): Promise<void> {
    const base = {
      clinicId: plan.clinicId,
      planId: plan.id,
      actorId: actor.id,
    };
    for (const issue of checked.issues) {
      if (issue.kind === 'gap') {
        const step = steps.find((s) => s.seq === issue.seq)!;
        await TreatmentHistoryService.record(tx, {
          ...base,
          action: 'gap_override',
          reason: overrides.gapReason,
          meta: {
            stepId: step.id,
            minGapDays: issue.minGapDays!,
            gapDays: step.gapDays,
          },
        });
      } else if (issue.kind === 'discount') {
        await TreatmentHistoryService.record(tx, {
          ...base,
          action: 'discount_approved',
          reason: overrides.discountReason,
          meta: {
            discountAmount: plan.discountAmount,
            capPercent: checked.capPercent,
          },
        });
      } else {
        await TreatmentHistoryService.record(tx, {
          ...base,
          action: 'duplicate_override',
          reason: overrides.duplicateReason,
          meta: { activePlanIds: checked.activePlanIds },
        });
      }
    }
  }

  /** The caller's own plan in one of `statuses`; else 404 (not visible) or 409 (no longer editable). */
  private static async loadOwn(
    clinicId: string,
    actor: Actor,
    planId: string,
    statuses: readonly TreatmentPlan['status'][]
  ): Promise<TreatmentPlan> {
    const [row] = await database
      .select()
      .from(P)
      .where(
        and(
          eq(P.id, planId),
          eq(P.clinicId, clinicId),
          eq(P.doctorId, actor.id)
        )
      )
      .limit(1);
    if (!row) throw new HttpError(404, 'Treatment plan not found');
    if (!statuses.includes(row.status))
      throw new HttpError(
        409,
        statuses.includes('accepted')
          ? 'This plan can no longer be changed here'
          : 'Only a suggested plan can be copied as another option'
      );
    return row;
  }
}

const PLAN_FIELDS = [
  'title',
  'diagnosis',
  'totalAmount',
  'discountAmount',
  'consentRequired',
  'packageExpiryDays',
] as const;

/** Order-sensitive fingerprint of a step list; fees compared in paise. */
const stepsKey = (steps: TreatmentPlanStep[]) =>
  JSON.stringify(
    [...steps]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => [
        s.name,
        s.gapDays,
        s.durationMinutes,
        toPaise(s.fee),
        s.selectedOption,
        s.specialtyData,
      ])
  );

function changedFields(
  before: TreatmentPlan,
  after: TreatmentPlan,
  oldSteps: TreatmentPlanStep[],
  newSteps: TreatmentPlanStep[]
): string[] {
  const changed: string[] = PLAN_FIELDS.filter(
    (f) => String(before[f]) !== String(after[f])
  );
  if (stepsKey(oldSteps) !== stepsKey(newSteps)) changed.push('steps');
  return changed;
}
