import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, invalidateCache } from '../../../../utils/cache.util';
import {
  TreatmentTemplateModel as T,
  TreatmentTemplateStepModel as Step,
  type NewTreatmentTemplate,
  type TreatmentTemplate,
  type TreatmentTemplateStep,
} from '../../models/treatmentTemplate.model';
import type { TemplateBody } from '../../schemas/template.schema';
import type {
  Actor,
  TemplateDetail,
  TemplateScope,
} from '../../types/template.types';
import { isUniqueViolation } from '../../../../utils/db.utils';
import { toPaise } from '../../utils/money.utils';
import { TreatmentHistoryService } from '../history.service';
import { TemplateQueryService } from './templateQuery.service';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Body = TemplateBody & { code?: string | null };
type StepInput = TemplateBody['steps'][number];
type TargetStatus = 'active' | 'inactive' | 'archived';

// Allowed moves; archived is final.
const NEXT_STATUS: Record<TreatmentTemplate['status'], TargetStatus[]> = {
  draft: ['active', 'archived'],
  active: ['inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: [],
};

const COMPARED_FIELDS = [
  'name',
  'specialty',
  'planType',
  'pricingMode',
  'packagePrice',
  'sessionCount',
  'intervalDays',
  'packageExpiryDays',
  'consentRequired',
  'taxable',
  'instalmentsAllowed',
  'recallAfterDays',
  'diagnosisKeywords',
] as const;

export class TemplateWriteService {
  /** A clinic template, a doctor's own version (ownVersion), or a library row (scope.clinicId null). */
  static async create(
    scope: TemplateScope,
    actor: Actor,
    body: Body & { ownVersion?: boolean },
    sourceTemplateId: string | null = null
  ): Promise<TemplateDetail> {
    if (body.ownVersion && !actor.isDoctor)
      throw new HttpError(403, 'Only a doctor can save their own version');

    const { row, steps } = await this.saveDuplicateSafe(() =>
      database.transaction(async (tx) => {
        const [row] = await tx
          .insert(T)
          .values({
            ...this.columns(body),
            clinicId: scope.clinicId,
            code: scope.clinicId === null ? (body.code ?? null) : null,
            ownerDoctorId: body.ownVersion ? actor.id : null,
            sourceTemplateId,
            createdBy: actor.id,
          })
          .returning();
        const steps = await this.insertSteps(
          tx,
          row.id,
          scope.clinicId,
          body.steps
        );
        return { row: await this.goLiveIfPriced(tx, row, actor.id), steps };
      })
    );
    await this.afterWrite(scope);
    return TemplateQueryService.toDetail(row, steps, false);
  }

  /** Edits in place; plans already made keep their own copy of steps and fees (DEV_PLAN §3.2). */
  static async update(
    scope: TemplateScope,
    actor: Actor,
    id: string,
    body: Body
  ): Promise<TemplateDetail> {
    const { row: saved, steps } = await this.saveDuplicateSafe(() =>
      database.transaction(async (tx) => {
        const row = await this.lockEditable(tx, scope, actor, id);
        const oldSteps = await tx
          .select()
          .from(Step)
          .where(eq(Step.templateId, id))
          .orderBy(asc(Step.seq));

        const changedFields = COMPARED_FIELDS.filter((f) =>
          f === 'packagePrice'
            ? !sameMoney(row[f], body[f])
            : !same(row[f], body[f])
        ) as string[];
        if (scope.clinicId === null && (body.code ?? null) !== row.code)
          changedFields.push('code');
        if (stepsKey(oldSteps) !== stepsKey(body.steps))
          changedFields.push('steps');
        if (!changedFields.length)
          return {
            row: await this.goLiveIfPriced(tx, row, actor.id),
            steps: oldSteps,
          };

        const [updated] = await tx
          .update(T)
          .set({
            ...this.columns(body),
            ...(scope.clinicId === null ? { code: body.code ?? null } : {}),
          })
          .where(eq(T.id, id))
          .returning();
        let steps = oldSteps;
        if (changedFields.includes('steps')) {
          await tx.delete(Step).where(eq(Step.templateId, id));
          steps = await this.insertSteps(tx, id, scope.clinicId, body.steps);
        }
        await TreatmentHistoryService.record(tx, {
          clinicId: scope.clinicId,
          templateId: id,
          actorId: actor.id,
          action: 'template_edit',
          meta: { changedFields },
        });
        // A live clinic template can't lose a price: doctors would start plans at ₹0. Rolls back.
        if (updated.status === 'active' && updated.clinicId !== null) {
          if (await this.missingPrice(tx, updated))
            throw new HttpError(
              422,
              updated.pricingMode === 'package'
                ? 'Enter the package price: this template is in use'
                : 'Enter a fee for every step: this template is in use'
            );
        }
        return {
          row: await this.goLiveIfPriced(tx, updated, actor.id),
          steps,
        };
      })
    );
    await this.afterWrite(scope);
    return TemplateQueryService.toDetail(saved, steps);
  }

  /** "Checked": required before a template goes live; records who checked it and when.
   *  Clinic Admin or Doctor (route-guarded); Super Admin for the library. */
  static async check(
    scope: TemplateScope,
    actor: Actor,
    id: string
  ): Promise<TemplateDetail> {
    const saved = await database.transaction(async (tx) => {
      await this.lockEditable(tx, scope, actor, id);
      const [updated] = await tx
        .update(T)
        .set({ checkedBy: actor.id, checkedAt: new Date() })
        .where(eq(T.id, id))
        .returning();
      await TreatmentHistoryService.record(tx, {
        clinicId: scope.clinicId,
        templateId: id,
        actorId: actor.id,
        action: 'template_edit',
        meta: { changedFields: ['checked'] },
      });
      return updated;
    });
    await this.afterWrite(scope);
    return TemplateQueryService.toDetail(saved);
  }

  static async setStatus(
    scope: TemplateScope,
    actor: Actor,
    id: string,
    to: TargetStatus
  ): Promise<TemplateDetail> {
    const saved = await database.transaction(async (tx) => {
      const row = await this.lockVisible(tx, scope, actor, id);
      if (!NEXT_STATUS[row.status].includes(to))
        throw new HttpError(
          409,
          row.status === 'archived'
            ? 'This template is archived and can no longer change'
            : `A ${row.status} template can't be made ${to}`
        );
      if (to === 'active') await this.assertActivatable(tx, row);

      const [updated] = await tx
        .update(T)
        .set({ status: to })
        .where(eq(T.id, id))
        .returning();
      await TreatmentHistoryService.record(tx, {
        clinicId: scope.clinicId,
        templateId: id,
        actorId: actor.id,
        action: 'status_change',
        meta: null,
        fromValue: row.status,
        toValue: to,
      });
      return updated;
    });
    await this.afterWrite(scope);
    return TemplateQueryService.toDetail(saved);
  }

  /** Library → clinic copy, or library/clinic template → the doctor's own version. A copy with
   *  every price set goes live; otherwise it stays a draft until the clinic adds its fees. */
  static async copy(
    clinicId: string,
    actor: Actor,
    sourceId: string,
    target: 'clinic' | 'own'
  ): Promise<TemplateDetail> {
    if (target === 'own' && !actor.isDoctor)
      throw new HttpError(403, 'Only a doctor can save their own version');

    const { row: copied, steps: copiedSteps } = await database.transaction(
      async (tx) => {
        const source = await this.findCopySource(
          tx,
          clinicId,
          sourceId,
          target
        );
        const {
          id: _id,
          clinicId: _clinicId,
          code: _code,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...fields
        } = source;
        const [row] = await tx
          .insert(T)
          .values({
            ...fields,
            clinicId,
            ownerDoctorId: target === 'own' ? actor.id : null,
            sourceTemplateId: source.id,
            status: 'draft',
            checkedBy: null,
            checkedAt: null,
            createdBy: actor.id,
          })
          .returning();

        const steps = await tx
          .select()
          .from(Step)
          .where(eq(Step.templateId, source.id))
          .orderBy(asc(Step.seq));
        const newSteps = await this.insertSteps(tx, row.id, clinicId, steps);
        await TreatmentHistoryService.record(tx, {
          clinicId,
          templateId: row.id,
          actorId: actor.id,
          action: 'template_copy',
          meta: { sourceTemplateId: source.id },
        });
        return {
          row: await this.goLiveIfPriced(tx, row, actor.id),
          steps: newSteps,
        };
      }
    );
    await this.afterWrite({ clinicId });
    // Just copied, so the source cannot be newer yet.
    return TemplateQueryService.toDetail(copied, copiedSteps, false);
  }

  private static columns(body: Body): Omit<NewTreatmentTemplate, 'createdBy'> {
    return {
      name: body.name,
      specialty: body.specialty,
      planType: body.planType,
      pricingMode: body.pricingMode,
      packagePrice: body.packagePrice ?? null,
      sessionCount: body.sessionCount ?? null,
      intervalDays: body.intervalDays ?? null,
      packageExpiryDays: body.packageExpiryDays ?? null,
      consentRequired: body.consentRequired,
      taxable: body.taxable,
      instalmentsAllowed: body.instalmentsAllowed,
      recallAfterDays: body.recallAfterDays ?? null,
      diagnosisKeywords: body.diagnosisKeywords,
    };
  }

  private static async insertSteps(
    tx: Tx,
    templateId: string,
    clinicId: string | null,
    steps: (StepInput | typeof Step.$inferSelect)[]
  ): Promise<TreatmentTemplateStep[]> {
    if (!steps.length) return [];
    const rows = await tx
      .insert(Step)
      .values(
        steps.map((s, i) => ({
          templateId,
          clinicId,
          seq: i + 1,
          name: s.name,
          gapDays: s.gapDays,
          maxGapDays: s.maxGapDays ?? null,
          durationMinutes: s.durationMinutes ?? null,
          fee: s.fee ?? null,
          options: s.options ?? [],
        }))
      )
      .returning();
    // RETURNING order is not guaranteed; the response lists steps by seq.
    return rows.sort((a, b) => a.seq - b.seq);
  }

  /** Visible to the caller, locked for the rest of the transaction; else 404. */
  private static async lockVisible(
    tx: Tx,
    scope: TemplateScope,
    actor: Actor,
    id: string
  ): Promise<TreatmentTemplate> {
    const [row] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, id), TemplateQueryService.visible(scope, actor)))
      .for('update');
    if (!row) throw new HttpError(404, 'Template not found');
    return row;
  }

  private static async lockEditable(
    tx: Tx,
    scope: TemplateScope,
    actor: Actor,
    id: string
  ): Promise<TreatmentTemplate> {
    const row = await this.lockVisible(tx, scope, actor, id);
    if (row.status === 'archived')
      throw new HttpError(
        409,
        'This template is archived and can no longer change'
      );
    return row;
  }

  private static async assertActivatable(
    tx: Tx,
    row: TreatmentTemplate
  ): Promise<void> {
    if (!row.checkedAt)
      throw new HttpError(422, 'Mark this template as checked first');
    // Library fees are suggestions; a clinic must price its own copy before activating it.
    if (row.clinicId === null) return;
    const missing = await this.missingPrice(tx, row);
    if (missing) throw new HttpError(422, missing);
  }

  /** Why the template can't go live yet for lack of a price, or null when every price is set. */
  private static async missingPrice(
    tx: Tx,
    row: TreatmentTemplate
  ): Promise<string | null> {
    if (row.pricingMode === 'package' && row.packagePrice === null)
      return 'Enter the package price first';
    if (row.pricingMode === 'per_step') {
      const [unpriced] = await tx
        .select({ id: Step.id })
        .from(Step)
        .where(and(eq(Step.templateId, row.id), isNull(Step.fee)))
        .limit(1);
      if (unpriced) return 'Enter a fee for every step first';
    }
    return null;
  }

  /** A clinic draft with every price set goes live on save: checked and active, no extra clicks.
   *  The library keeps its own check and publish steps. */
  private static async goLiveIfPriced(
    tx: Tx,
    row: TreatmentTemplate,
    actorId: string
  ): Promise<TreatmentTemplate> {
    if (row.clinicId === null || row.status !== 'draft') return row;
    if (await this.missingPrice(tx, row)) return row;
    const [live] = await tx
      .update(T)
      .set({
        status: 'active',
        checkedBy: row.checkedBy ?? actorId,
        checkedAt: row.checkedAt ?? new Date(),
      })
      .where(eq(T.id, row.id))
      .returning();
    await TreatmentHistoryService.record(tx, {
      clinicId: row.clinicId,
      templateId: row.id,
      actorId,
      action: 'status_change',
      meta: null,
      fromValue: 'draft',
      toValue: 'active',
    });
    return live;
  }

  private static async findCopySource(
    tx: Tx,
    clinicId: string,
    sourceId: string,
    target: 'clinic' | 'own'
  ): Promise<TreatmentTemplate> {
    if (target === 'own') {
      const [clinicRow] = await tx
        .select()
        .from(T)
        .where(
          and(
            eq(T.id, sourceId),
            eq(T.clinicId, clinicId),
            isNull(T.ownerDoctorId),
            ne(T.status, 'archived')
          )
        );
      if (clinicRow) return clinicRow;
    }
    const [libraryRow] = await tx
      .select()
      .from(T)
      .where(and(eq(T.id, sourceId), isNull(T.clinicId)));
    if (!libraryRow) throw new HttpError(404, 'Template not found');
    if (libraryRow.status !== 'active')
      throw new HttpError(
        422,
        'Only active ready-made templates can be copied'
      );
    return libraryRow;
  }

  private static async saveDuplicateSafe<R>(
    save: () => Promise<R>
  ): Promise<R> {
    try {
      return await save();
    } catch (err) {
      if (isUniqueViolation(err))
        throw new HttpError(
          409,
          'Another ready-made template already uses this code'
        );
      throw err;
    }
  }

  /** After commit: the clinic's active-templates cache (§8.1); the library has none. */
  private static async afterWrite(scope: TemplateScope): Promise<void> {
    if (scope.clinicId)
      await invalidateCache(CacheKeys.treatmentTemplatesActive(scope.clinicId));
  }
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? null) === (b ?? null);
}

// "1500" and "1500.00" are the same price.
function sameMoney(a?: string | null, b?: string | null): boolean {
  return a == null || b == null
    ? (a ?? null) === (b ?? null)
    : toPaise(a) === toPaise(b);
}

/** Order-sensitive fingerprint of a step list; fees compared in paise. */
function stepsKey(steps: (StepInput | typeof Step.$inferSelect)[]): string {
  return JSON.stringify(
    steps.map((s) => [
      s.name,
      s.gapDays,
      s.maxGapDays ?? null,
      s.durationMinutes ?? null,
      s.fee == null ? null : toPaise(s.fee),
      (s.options ?? []).map((o) => [o.label, toPaise(o.extraFee)]),
    ])
  );
}
