import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, getOrSetCache } from '../../../../utils/cache.util';
import { getISTDateString } from '../../../../utils/istDateTime';
import { findSpecialtyGroup } from '../../../../utils/specialtyCatalog';
import {
  TreatmentTemplateModel as T,
  TreatmentTemplateStepModel as Step,
  type TreatmentTemplate,
  type TreatmentTemplateStep,
} from '../../models/treatmentTemplate.model';
import { getDoctorPort } from '../../ports';
import type {
  TemplateListQuery,
  TemplatePreviewInput,
} from '../../schemas/template.schema';
import type {
  Actor,
  ActiveTemplate,
  TemplateDetail,
  TemplateListItem,
  TemplatePreview,
  TemplateScope,
} from '../../types/template.types';
import { escapeLike } from '../../utils/db.utils';
import { buildPreview } from '../../utils/templatePreview.utils';

const ACTIVE_TTL_SECONDS = 600;

// The outer table is named explicitly: drizzle prints ${T.id} as a bare "id", which binds to the steps table.
const stepCount = sql<number>`(select count(*)::int from ${Step} s where s.template_id = ${T}.id)`;
// Null while any step has no fee, so a half-priced template never shows a wrong total; a review's one fee counts per review.
// Steps with no fee yet, so the list can say why a draft is not ready (same select, no extra call).
const stepsUnpriced = sql<number>`(select count(*)::int from ${Step} s where s.template_id = ${T}.id and s.fee is null)`;
const stepsFeeTotal = sql<
  string | null
>`(select case when bool_and(s.fee is not null) then (sum(s.fee) * case when ${T}.plan_type = 'review' then coalesce(${T}.session_count, 1) else 1 end)::text end from ${Step} s where s.template_id = ${T}.id)`;

export class TemplateQueryService {
  /** Rows a caller may read: the library, or the clinic's templates plus the caller's own versions. */
  static visible(scope: TemplateScope, actor: Actor | null): SQL {
    if (scope.clinicId === null) return isNull(T.clinicId);
    return and(
      eq(T.clinicId, scope.clinicId),
      actor
        ? or(isNull(T.ownerDoctorId), eq(T.ownerDoctorId, actor.id))
        : isNull(T.ownerDoctorId)
    )!;
  }

  /** Management list: filters, contains-search ranked in SQL, paginated. Archived only on request. */
  static async list(
    scope: TemplateScope,
    actor: Actor | null,
    query: TemplateListQuery
  ) {
    const { status, specialty, q, owner, pageNumber, pageSize } = query;
    const filters: SQL[] = [this.visible(scope, actor)];
    filters.push(status ? eq(T.status, status) : ne(T.status, 'archived'));
    if (specialty) filters.push(eq(T.specialty, specialty));
    if (owner === 'clinic') filters.push(isNull(T.ownerDoctorId));
    if (owner === 'mine' && actor) filters.push(eq(T.ownerDoctorId, actor.id));
    if (q) filters.push(ilike(T.name, `%${escapeLike(q)}%`));
    const where = and(...filters);

    const rank = q
      ? sql`case when lower(${T.name}) = lower(${q}) then 0
          when ${T.name} ilike ${`${escapeLike(q)}%`} then 1
          when ${T.name} ilike ${`% ${escapeLike(q)}%`} then 2 else 3 end`
      : null;

    const [rows, [count]] = await Promise.all([
      database
        .select({
          id: T.id,
          name: T.name,
          specialty: T.specialty,
          planType: T.planType,
          status: T.status,
          pricingMode: T.pricingMode,
          packagePrice: T.packagePrice,
          sessionCount: T.sessionCount,
          intervalDays: T.intervalDays,
          ownerDoctorId: T.ownerDoctorId,
          checkedAt: T.checkedAt,
          sourceTemplateId: T.sourceTemplateId,
          updatedAt: T.updatedAt,
          stepCount,
          stepsUnpriced,
          stepsFeeTotal,
        })
        .from(T)
        .where(where)
        .orderBy(
          ...(rank
            ? [rank, sql`length(${T.name})`, asc(T.name)]
            : [desc(T.updatedAt)])
        )
        .limit(pageSize)
        .offset((pageNumber - 1) * pageSize),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(T)
        .where(where),
    ]);

    const items: TemplateListItem[] = rows.map(
      ({ ownerDoctorId, checkedAt, ...row }) => ({
        ...row,
        isOwnVersion: ownerDoctorId !== null,
        checked: checkedAt !== null,
      })
    );
    return { items, total: count?.total ?? 0, pageNumber, pageSize };
  }

  static async get(
    scope: TemplateScope,
    actor: Actor | null,
    id: string
  ): Promise<TemplateDetail> {
    const [row] = await database
      .select()
      .from(T)
      .where(and(eq(T.id, id), this.visible(scope, actor)))
      .limit(1);
    if (!row) throw new HttpError(404, 'Template not found');
    return this.toDetail(row);
  }

  /** Detail from a row the caller already holds; steps are read only when not passed in.
   *  Writes pass what they just wrote, so the response costs no extra read. */
  static async toDetail(
    row: TreatmentTemplate,
    knownSteps?: TreatmentTemplateStep[],
    knownNewer?: boolean
  ): Promise<TemplateDetail> {
    const [steps, newerLibraryVersion] = await Promise.all([
      knownSteps ??
        database
          .select()
          .from(Step)
          .where(eq(Step.templateId, row.id))
          .orderBy(asc(Step.seq)),
      knownNewer ??
        this.hasNewerLibraryVersion(
          row.clinicId,
          row.sourceTemplateId,
          row.createdAt
        ),
    ]);
    const { clinicId: _clinicId, ...template } = row;
    return {
      ...template,
      steps: steps.map((s) => ({
        id: s.id,
        seq: s.seq,
        name: s.name,
        gapDays: s.gapDays,
        maxGapDays: s.maxGapDays,
        durationMinutes: s.durationMinutes,
        fee: s.fee,
        options: s.options,
      })),
      newerLibraryVersion,
    };
  }

  /** Active templates a doctor may use (DEV_PLAN §3.2): their specialties, clinic copies and
   *  their own versions; an own version replaces the clinic template it came from.
   *  anySpecialty keeps other specialties too, flagged mySpecialty: false (the New plan picker). */
  static async availableForDoctor(
    clinicId: string,
    doctorId: string,
    anySpecialty = false
  ): Promise<(ActiveTemplate & { mySpecialty: boolean })[]> {
    const [specialties, active] = await Promise.all([
      getDoctorPort().getSpecialties(doctorId),
      this.activeForClinic(clinicId),
    ]);
    const mine = new Set(specialties.map((s) => s.toLowerCase()));
    const usable = active
      .map((t) => ({ ...t, mySpecialty: mine.has(t.specialty.toLowerCase()) }))
      .filter(
        (t) =>
          (anySpecialty || t.mySpecialty) &&
          (t.ownerDoctorId === null || t.ownerDoctorId === doctorId)
      );
    const replaced = new Set(
      usable
        .filter((t) => t.ownerDoctorId === doctorId)
        .map((t) => t.sourceTemplateId)
    );
    return usable
      .filter((t) => !replaced.has(t.id))
      .sort(
        (a, b) =>
          Number(b.ownerDoctorId !== null) - Number(a.ownerDoctorId !== null) ||
          a.name.localeCompare(b.name)
      );
  }

  /** The New plan picker's list: every active clinic template, the doctor's specialties first, then most used. */
  static async pickerForDoctor(
    clinicId: string,
    doctorId: string
  ): Promise<(ActiveTemplate & { mySpecialty: boolean; useCount: number })[]> {
    const [available, used] = await Promise.all([
      this.availableForDoctor(clinicId, doctorId, true),
      database.execute(sql`SELECT template_id AS id, COUNT(*)::int AS n FROM treatment_plans
        WHERE clinic_id = ${clinicId} AND doctor_id = ${doctorId} AND template_id IS NOT NULL
        GROUP BY template_id`) as unknown as Promise<
        { id: string; n: number }[]
      >,
    ]);
    const counts = new Map(used.map((r) => [r.id, Number(r.n)]));
    // Stable sort: equal counts keep the own-version-then-name order.
    return available
      .map((t) => ({ ...t, useCount: counts.get(t.id) ?? 0 }))
      .sort(
        (a, b) =>
          Number(b.mySpecialty) - Number(a.mySpecialty) ||
          b.useCount - a.useCount
      );
  }

  /** Library rows a clinic may copy: active only (a draft has no reviewed fees). mySpecialties
   *  lets the screen start on the user's own speciality; an Admin without one gets []. */
  static async libraryForClinic(query: TemplateListQuery, userId: string) {
    const [page, mySpecialties] = await Promise.all([
      this.list({ clinicId: null }, null, { ...query, status: 'active' }),
      getDoctorPort().getSpecialties(userId),
    ]);
    // Only main specialities: a template saves with no other (sub-specialities and custom ones fail).
    return {
      ...page,
      mySpecialties: mySpecialties.filter((s) => findSpecialtyGroup(s)),
    };
  }

  static async libraryTemplateForClinic(id: string): Promise<TemplateDetail> {
    const detail = await this.get({ clinicId: null }, null, id);
    if (detail.status !== 'active')
      throw new HttpError(404, 'Template not found');
    return detail;
  }

  static preview(input: TemplatePreviewInput): TemplatePreview {
    return buildPreview(input, input.startDate ?? getISTDateString());
  }

  /** Every active template of the clinic, cached; filtered per doctor in availableForDoctor. */
  private static activeForClinic(clinicId: string) {
    return getOrSetCache<ActiveTemplate[]>(
      CacheKeys.treatmentTemplatesActive(clinicId),
      ACTIVE_TTL_SECONDS,
      () =>
        database
          .select({
            id: T.id,
            name: T.name,
            specialty: T.specialty,
            planType: T.planType,
            pricingMode: T.pricingMode,
            packagePrice: T.packagePrice,
            sessionCount: T.sessionCount,
            ownerDoctorId: T.ownerDoctorId,
            sourceTemplateId: T.sourceTemplateId,
            diagnosisKeywords: T.diagnosisKeywords,
            stepCount,
            stepsFeeTotal,
          })
          .from(T)
          .where(and(eq(T.clinicId, clinicId), eq(T.status, 'active')))
          // Bounds the cached list; a clinic is not expected near this many active templates.
          .limit(500)
    );
  }

  private static async hasNewerLibraryVersion(
    clinicId: string | null,
    sourceId: string | null,
    copiedAt: Date
  ): Promise<boolean> {
    if (clinicId === null || sourceId === null) return false;
    const [source] = await database
      .select({ updatedAt: T.updatedAt })
      .from(T)
      .where(and(eq(T.id, sourceId), isNull(T.clinicId)))
      .limit(1);
    return !!source && source.updatedAt > copiedAt;
  }
}
