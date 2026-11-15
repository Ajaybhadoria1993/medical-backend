import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { SubscriptionModel } from '../../models/ownerSubscription.model';
import { AddOnModel, PlanAddOnLimitsModel } from '../../models/addon.model';
import { PlanFeaturesModel } from '../../models/planFeatures.model';
import {
  PlanVersionModel,
  type PlanVersion,
} from '../../models/planVersion.model';
import { SubscriptionPlanModel } from '../../models/subscription.model';
import { subscriptionNotify } from '../../notify/subscriptionNotify';
import type { OwnerType } from './ownerSubscription.service';
import { getClinicPort } from '../../ports';

export class PlansService {
  static async currentVersion(
    planId: string,
    at: Date = new Date()
  ): Promise<PlanVersion | null> {
    const [version] = await database
      .select()
      .from(PlanVersionModel)
      .where(
        and(
          eq(PlanVersionModel.planId, planId),
          lte(PlanVersionModel.effectiveFrom, at)
        )
      )
      .orderBy(desc(PlanVersionModel.effectiveFrom))
      .limit(1);
    return version ?? null;
  }

  /** The version in force now for each plan, in one query. */
  static async currentVersions(planIds: string[], at = new Date()) {
    const current = new Map<string, PlanVersion>();
    if (!planIds.length) return current;
    const versions = await database
      .select()
      .from(PlanVersionModel)
      .where(
        and(
          inArray(PlanVersionModel.planId, planIds),
          lte(PlanVersionModel.effectiveFrom, at)
        )
      )
      .orderBy(desc(PlanVersionModel.effectiveFrom));
    // Sorted newest first, so the first row seen per plan is its current version.
    for (const v of versions)
      if (!current.has(v.planId)) current.set(v.planId, v);
    return current;
  }

  /** Each plan's newest version id, for the Super Admin screens that edit it. */
  static async latestVersionIds(): Promise<string[]> {
    const rows = await database
      .selectDistinctOn([PlanVersionModel.planId], { id: PlanVersionModel.id })
      .from(PlanVersionModel)
      .orderBy(PlanVersionModel.planId, desc(PlanVersionModel.versionNo));
    return rows.map((r) => r.id);
  }

  /** For display-only edits (marketing text), which may change on a version in use. */
  static async latestVersion(planId: string) {
    const [latest] = await database
      .select()
      .from(PlanVersionModel)
      .where(eq(PlanVersionModel.planId, planId))
      .orderBy(desc(PlanVersionModel.versionNo))
      .limit(1);
    if (!latest) throw new HttpError(404, 'This plan has no version yet.');
    return latest;
  }

  /** The plan's newest version, if no clinic is on it yet; prices and limits of a version in use never change. */
  static async editableVersion(planId: string) {
    const latest = await PlansService.latestVersion(planId);
    const [used] = await database
      .select({ id: SubscriptionModel.id })
      .from(SubscriptionModel)
      .where(eq(SubscriptionModel.planVersionId, latest.id))
      .limit(1);
    if (used) {
      throw new HttpError(
        409,
        'Clinics are on this version, so its prices and limits cannot change. Create a new version instead.'
      );
    }
    return latest;
  }

  /** Newest version first, with how many clinics are on each now. */
  static async versionsOf(planId: string) {
    return database
      .select({
        version: PlanVersionModel,
        clinics: sql<number>`count(${SubscriptionModel.id})::int`,
      })
      .from(PlanVersionModel)
      .leftJoin(
        SubscriptionModel,
        and(
          eq(SubscriptionModel.planVersionId, PlanVersionModel.id),
          inArray(SubscriptionModel.status, ['trialing', 'active', 'past_due'])
        )
      )
      .where(eq(PlanVersionModel.planId, planId))
      .groupBy(PlanVersionModel.id)
      .orderBy(desc(PlanVersionModel.versionNo));
  }

  /** Limits and add-on caps of the given versions, keyed by version id. */
  static async contentsOf(versionIds: string[]) {
    if (!versionIds.length)
      return new Map<
        string,
        {
          features: (typeof PlanFeaturesModel.$inferSelect)[];
          addOnCaps: {
            addOnId: string;
            addOnName: string;
            maxCap: number | null;
          }[];
        }
      >();
    const [features, caps] = await Promise.all([
      database
        .select()
        .from(PlanFeaturesModel)
        .where(inArray(PlanFeaturesModel.planVersionId, versionIds))
        .orderBy(
          asc(PlanFeaturesModel.sortOrder),
          asc(PlanFeaturesModel.createdAt)
        ),
      database
        .select({
          planVersionId: PlanAddOnLimitsModel.planVersionId,
          addOnId: PlanAddOnLimitsModel.addOnId,
          addOnName: AddOnModel.name,
          maxCap: PlanAddOnLimitsModel.maxCap,
        })
        .from(PlanAddOnLimitsModel)
        .innerJoin(AddOnModel, eq(AddOnModel.id, PlanAddOnLimitsModel.addOnId))
        .where(inArray(PlanAddOnLimitsModel.planVersionId, versionIds)),
    ]);
    return new Map(
      versionIds.map((id) => [
        id,
        {
          features: features.filter((f) => f.planVersionId === id),
          addOnCaps: caps
            .filter((c) => c.planVersionId === id)
            .map(({ planVersionId: _v, ...c }) => c),
        },
      ])
    );
  }

  /** Clinics on the plan now: which version, cycle and when they renew. */
  static async clinicsOn(planId: string) {
    const rows = await database
      .select({
        clinicId: SubscriptionModel.ownerId,
        versionNo: PlanVersionModel.versionNo,
        status: SubscriptionModel.status,
        isTrial: SubscriptionModel.isTrial,
        billingCycle: SubscriptionModel.billingCycle,
        renewsOn: SubscriptionModel.currentPeriodEnd,
        cancelAtPeriodEnd: SubscriptionModel.cancelAtPeriodEnd,
      })
      .from(SubscriptionModel)
      .innerJoin(
        PlanVersionModel,
        eq(PlanVersionModel.id, SubscriptionModel.planVersionId)
      )
      .where(
        and(
          eq(PlanVersionModel.planId, planId),
          eq(SubscriptionModel.ownerType, 'clinic'),
          inArray(SubscriptionModel.status, ['trialing', 'active', 'past_due'])
        )
      )
      .orderBy(asc(SubscriptionModel.currentPeriodEnd));
    const clinics = await getClinicPort().getClinics(
      rows.map((r) => r.clinicId)
    );
    return rows.flatMap((r) => {
      const c = clinics.get(r.clinicId);
      return c ? [{ ...r, clinicName: c.name }] : [];
    });
  }

  /** Feature wording is display-only, so it changes on every version of the plan at once. */
  static async renameFeature(
    planId: string,
    featureKey: string,
    input: {
      displayName?: string;
      description?: string | null;
      linkedFeatureKey?: string | null;
      enabled?: boolean;
    }
  ) {
    if (input.linkedFeatureKey) {
      const [target] = await database
        .select({ type: PlanFeaturesModel.type })
        .from(PlanFeaturesModel)
        .where(
          and(
            eq(PlanFeaturesModel.planId, planId),
            eq(PlanFeaturesModel.featureKey, input.linkedFeatureKey)
          )
        )
        .limit(1);
      if (!target || target.type === 'marketing')
        throw new HttpError(
          400,
          "Link a selling point to one of this plan's limits."
        );
    }
    const rows = await database
      .update(PlanFeaturesModel)
      .set({
        ...(input.displayName !== undefined && {
          displayName: input.displayName,
        }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.linkedFeatureKey !== undefined && {
          linkedFeatureKey: input.linkedFeatureKey,
        }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(PlanFeaturesModel.planId, planId),
          eq(PlanFeaturesModel.featureKey, featureKey),
          // A limit's on/off is a price change, so only selling points switch here.
          ...(input.enabled !== undefined
            ? [eq(PlanFeaturesModel.isMarketingFeature, true)]
            : [])
        )
      )
      .returning({ id: PlanFeaturesModel.id });
    if (!rows.length)
      throw new HttpError(404, 'Feature not found on this plan.');
  }

  /** Display order is display-only, so it changes on every version of the plan at once. */
  static async reorderFeatures(planId: string, featureKeys: string[]) {
    await database.transaction(async (tx) => {
      for (const [i, featureKey] of featureKeys.entries()) {
        await tx
          .update(PlanFeaturesModel)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(PlanFeaturesModel.planId, planId),
              eq(PlanFeaturesModel.featureKey, featureKey)
            )
          );
      }
    });
  }

  /** Drops selling points whose linked limit is off, so a card never promises what the plan lacks. */
  static forSale<
    F extends {
      featureKey: string;
      type: string;
      enabled: boolean;
      isUnlimited: boolean;
      limitValue: number | null;
      linkedFeatureKey: string | null;
      isMarketingFeature: boolean | null;
    },
  >(features: F[]): F[] {
    const off = new Set(
      features
        .filter(
          (f) =>
            !f.enabled ||
            (f.type === 'numeric' && !f.isUnlimited && f.limitValue === 0)
        )
        .map((f) => f.featureKey)
    );
    return features.filter(
      (f) =>
        !(f.isMarketingFeature && !f.enabled) &&
        (!f.linkedFeatureKey || !off.has(f.linkedFeatureKey))
    );
  }

  /** A text-only selling point added to the live version and any scheduled one. */
  static async addMarketingFeature(
    planId: string,
    input: { displayName: string; description?: string | null }
  ) {
    const now = new Date();
    const versions = await database
      .select({
        id: PlanVersionModel.id,
        effectiveFrom: PlanVersionModel.effectiveFrom,
      })
      .from(PlanVersionModel)
      .where(eq(PlanVersionModel.planId, planId))
      .orderBy(desc(PlanVersionModel.versionNo));
    const liveIndex = versions.findIndex((v) => v.effectiveFrom <= now);
    const targets = versions.slice(
      0,
      liveIndex === -1 ? versions.length : liveIndex + 1
    );
    if (!targets.length)
      throw new HttpError(404, 'This plan has no version yet.');
    const featureKey = `marketing_${Date.now().toString(36)}`;
    await database.insert(PlanFeaturesModel).values(
      targets.map((v) => ({
        planId,
        planVersionId: v.id,
        featureKey,
        displayName: input.displayName,
        description: input.description ?? null,
        type: 'marketing',
        isMarketingFeature: true,
        enabled: true,
        sortOrder: 999,
      }))
    );
    return { featureKey };
  }

  /** Only text-only selling points can be removed in place; limits change through a new version. */
  static async removeMarketingFeature(planId: string, featureKey: string) {
    const rows = await database
      .delete(PlanFeaturesModel)
      .where(
        and(
          eq(PlanFeaturesModel.planId, planId),
          eq(PlanFeaturesModel.featureKey, featureKey),
          eq(PlanFeaturesModel.isMarketingFeature, true)
        )
      )
      .returning({ id: PlanFeaturesModel.id });
    if (!rows.length) {
      throw new HttpError(
        409,
        'Only text-only selling points can be removed here. To remove a limit, create a new version.'
      );
    }
  }

  /** A new plan with version 1, starting now; it is not sold until a Super Admin puts it on sale. */
  static async createPlan(
    input: {
      name: string;
      description?: string | null;
      kind: 'paid' | 'free';
      monthlyPrice: number | null;
      yearlyPrice: number | null;
      features: {
        featureKey: string;
        displayName?: string | null;
        description?: string | null;
        type: string;
        limitValue: number | null;
        isUnlimited: boolean;
        enabled: boolean;
        isMarketingFeature?: boolean;
      }[];
      addOnCaps?: { addOnId: string; maxCap: number | null }[];
    },
    createdBy: string | null
  ) {
    if (
      input.kind === 'paid' &&
      input.monthlyPrice === null &&
      input.yearlyPrice === null
    ) {
      throw new HttpError(
        400,
        'A paid plan needs a monthly or a yearly price.'
      );
    }
    const slug = input.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug)
      throw new HttpError(400, 'Enter a plan name with letters or numbers.');
    return database.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: SubscriptionPlanModel.id })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.slug, slug))
        .limit(1);
      if (clash)
        throw new HttpError(
          409,
          'A plan with this name already exists. Choose another name.'
        );
      const [plan] = await tx
        .insert(SubscriptionPlanModel)
        .values({
          slug,
          name: input.name.trim(),
          description: input.description ?? null,
          kind: input.kind,
          ownerType: 'clinic',
          isActive: false,
          price: String(input.monthlyPrice ?? 0),
        })
        .returning();
      const [version] = await tx
        .insert(PlanVersionModel)
        .values({
          planId: plan!.id,
          versionNo: 1,
          monthlyPrice:
            input.monthlyPrice === null ? null : String(input.monthlyPrice),
          yearlyPrice:
            input.yearlyPrice === null ? null : String(input.yearlyPrice),
          effectiveFrom: new Date(),
          createdBy,
        })
        .returning();
      if (input.features.length) {
        await tx.insert(PlanFeaturesModel).values(
          input.features.map((f, i) => ({
            planId: plan!.id,
            planVersionId: version!.id,
            featureKey: f.featureKey,
            displayName: f.displayName ?? null,
            description: f.description ?? null,
            type: f.type,
            limitValue: f.limitValue,
            isUnlimited: f.isUnlimited,
            enabled: f.enabled,
            isMarketingFeature: f.isMarketingFeature ?? false,
            sortOrder: i,
          }))
        );
      }
      if (input.addOnCaps?.length) {
        await tx.insert(PlanAddOnLimitsModel).values(
          input.addOnCaps.map((c) => ({
            planId: plan!.id,
            planVersionId: version!.id,
            addOnId: c.addOnId,
            maxCap: c.maxCap,
          }))
        );
      }
      return plan!;
    });
  }

  /** Next version: unsent limits and add-on caps are copied from the newest one. */
  static async createVersion(
    planId: string,
    input: {
      monthlyPrice: number | null;
      yearlyPrice: number | null;
      effectiveFrom: Date;
      limits?: {
        featureKey: string;
        limitValue: number | null;
        isUnlimited: boolean;
        enabled: boolean;
        type?: 'numeric' | 'boolean';
        displayName?: string;
      }[];
      addOnCaps?: { addOnId: string; maxCap: number | null }[];
    },
    createdBy: string | null
  ) {
    // A minute of slack for the time the form took to send.
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new HttpError(400, 'The start date cannot be in the past.');
    }
    return database.transaction(async (tx) => {
      const [plan] = await tx
        .select()
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, planId))
        .for('update');
      if (!plan) throw new HttpError(404, 'Plan not found.');
      if (
        plan.kind === 'paid' &&
        input.monthlyPrice === null &&
        input.yearlyPrice === null
      ) {
        throw new HttpError(
          400,
          'A paid plan needs a monthly or a yearly price.'
        );
      }
      const [latest] = await tx
        .select()
        .from(PlanVersionModel)
        .where(eq(PlanVersionModel.planId, planId))
        .orderBy(desc(PlanVersionModel.versionNo))
        .limit(1);
      if (latest && input.effectiveFrom <= latest.effectiveFrom) {
        throw new HttpError(
          400,
          'The start date must be after the latest version starts.'
        );
      }
      const [version] = await tx
        .insert(PlanVersionModel)
        .values({
          planId,
          versionNo: (latest?.versionNo ?? 0) + 1,
          monthlyPrice:
            input.monthlyPrice === null ? null : String(input.monthlyPrice),
          yearlyPrice:
            input.yearlyPrice === null ? null : String(input.yearlyPrice),
          effectiveFrom: input.effectiveFrom,
          createdBy,
        })
        .returning();

      const [features, caps] = latest
        ? await Promise.all([
            tx
              .select()
              .from(PlanFeaturesModel)
              .where(eq(PlanFeaturesModel.planVersionId, latest.id)),
            tx
              .select()
              .from(PlanAddOnLimitsModel)
              .where(eq(PlanAddOnLimitsModel.planVersionId, latest.id)),
          ])
        : [[], []];
      const limitBy = new Map(
        (input.limits ?? []).map((l) => [l.featureKey, l])
      );
      const capBy = new Map((input.addOnCaps ?? []).map((c) => [c.addOnId, c]));
      const featureRows = features.map(
        ({ id: _id, createdAt: _c, updatedAt: _u, ...f }) => ({
          ...f,
          planVersionId: version!.id,
          ...(limitBy.get(f.featureKey) ?? {}),
        })
      );
      for (const [key, l] of limitBy) {
        if (!features.some((f) => f.featureKey === key)) {
          // A switch new to this plan (e.g. WhatsApp packs) carries its own type and name.
          featureRows.push({
            ...l,
            type:
              l.type ??
              (l.limitValue === null && !l.isUnlimited ? 'boolean' : 'numeric'),
            planId,
            planVersionId: version!.id,
          } as (typeof featureRows)[number]);
        }
      }
      const capRows = caps.map(
        ({ id: _id, createdAt: _c, updatedAt: _u, ...c }) => ({
          ...c,
          planVersionId: version!.id,
          ...(capBy.get(c.addOnId) ?? {}),
        })
      );
      for (const [addOnId, c] of capBy) {
        if (!caps.some((x) => x.addOnId === addOnId)) {
          capRows.push({
            planId,
            planVersionId: version!.id,
            addOnId,
            maxCap: c.maxCap,
          } as (typeof capRows)[number]);
        }
      }
      if (featureRows.length)
        await tx.insert(PlanFeaturesModel).values(featureRows);
      if (capRows.length) await tx.insert(PlanAddOnLimitsModel).values(capRows);
      return version!;
    });
  }

  /** The plan's newest version, locked, if it has not started and no clinic is on it. */
  private static async scheduledVersion(
    tx: Parameters<Parameters<typeof database.transaction>[0]>[0],
    planId: string,
    versionId: string
  ) {
    const [version] = await tx
      .select()
      .from(PlanVersionModel)
      .where(
        and(
          eq(PlanVersionModel.id, versionId),
          eq(PlanVersionModel.planId, planId)
        )
      )
      .for('update');
    if (!version) throw new HttpError(404, 'Version not found.');
    const [newer] = await tx
      .select({ id: PlanVersionModel.id })
      .from(PlanVersionModel)
      .where(
        and(
          eq(PlanVersionModel.planId, planId),
          sql`${PlanVersionModel.versionNo} > ${version.versionNo}`
        )
      )
      .limit(1);
    if (newer || version.effectiveFrom <= new Date()) {
      throw new HttpError(
        409,
        'Only a scheduled version that has not started can change. Create a new version instead.'
      );
    }
    const [used] = await tx
      .select({ id: SubscriptionModel.id })
      .from(SubscriptionModel)
      .where(eq(SubscriptionModel.planVersionId, version.id))
      .limit(1);
    if (used) {
      throw new HttpError(
        409,
        'Clinics are already on this version, so it cannot change.'
      );
    }
    return version;
  }

  /** Changes a scheduled version's prices, start date, limits or add-on caps before it starts. */
  static async updateScheduledVersion(
    planId: string,
    versionId: string,
    input: {
      monthlyPrice: number | null;
      yearlyPrice: number | null;
      effectiveFrom: Date;
      limits?: {
        featureKey: string;
        limitValue: number | null;
        isUnlimited: boolean;
        enabled: boolean;
        type?: 'numeric' | 'boolean';
        displayName?: string;
      }[];
      addOnCaps?: { addOnId: string; maxCap: number | null }[];
    }
  ) {
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new HttpError(400, 'The start date cannot be in the past.');
    }
    return database.transaction(async (tx) => {
      const version = await PlansService.scheduledVersion(
        tx,
        planId,
        versionId
      );
      const [plan] = await tx
        .select({ kind: SubscriptionPlanModel.kind })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, planId));
      if (
        plan?.kind === 'paid' &&
        input.monthlyPrice === null &&
        input.yearlyPrice === null
      ) {
        throw new HttpError(
          400,
          'A paid plan needs a monthly or a yearly price.'
        );
      }
      const [previous] = await tx
        .select({ effectiveFrom: PlanVersionModel.effectiveFrom })
        .from(PlanVersionModel)
        .where(
          and(
            eq(PlanVersionModel.planId, planId),
            sql`${PlanVersionModel.versionNo} < ${version.versionNo}`
          )
        )
        .orderBy(desc(PlanVersionModel.versionNo))
        .limit(1);
      if (previous && input.effectiveFrom <= previous.effectiveFrom) {
        throw new HttpError(
          400,
          'The start date must be after the previous version starts.'
        );
      }
      const [updated] = await tx
        .update(PlanVersionModel)
        .set({
          monthlyPrice:
            input.monthlyPrice === null ? null : String(input.monthlyPrice),
          yearlyPrice:
            input.yearlyPrice === null ? null : String(input.yearlyPrice),
          effectiveFrom: input.effectiveFrom,
        })
        .where(eq(PlanVersionModel.id, version.id))
        .returning();
      for (const l of input.limits ?? []) {
        const changed = await tx
          .update(PlanFeaturesModel)
          .set({
            limitValue: l.limitValue,
            isUnlimited: l.isUnlimited,
            enabled: l.enabled,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(PlanFeaturesModel.planVersionId, version.id),
              eq(PlanFeaturesModel.featureKey, l.featureKey)
            )
          )
          .returning({ id: PlanFeaturesModel.id });
        // A switch new to this plan gets its row here, like on a new version.
        if (!changed.length) {
          await tx.insert(PlanFeaturesModel).values({
            planId,
            planVersionId: version.id,
            featureKey: l.featureKey,
            displayName: l.displayName ?? null,
            type:
              l.type ??
              (l.limitValue === null && !l.isUnlimited ? 'boolean' : 'numeric'),
            limitValue: l.limitValue,
            isUnlimited: l.isUnlimited,
            enabled: l.enabled,
          });
        }
      }
      for (const c of input.addOnCaps ?? []) {
        const [row] = await tx
          .update(PlanAddOnLimitsModel)
          .set({ maxCap: c.maxCap, updatedAt: new Date() })
          .where(
            and(
              eq(PlanAddOnLimitsModel.planVersionId, version.id),
              eq(PlanAddOnLimitsModel.addOnId, c.addOnId)
            )
          )
          .returning({ id: PlanAddOnLimitsModel.id });
        if (!row) {
          await tx.insert(PlanAddOnLimitsModel).values({
            planId,
            planVersionId: version.id,
            addOnId: c.addOnId,
            maxCap: c.maxCap,
          });
        }
      }
      return updated!;
    });
  }

  /** Cancels a scheduled version before it starts; the version before it stays in force. */
  static async deleteScheduledVersion(planId: string, versionId: string) {
    return database.transaction(async (tx) => {
      const version = await PlansService.scheduledVersion(
        tx,
        planId,
        versionId
      );
      await tx
        .delete(PlanFeaturesModel)
        .where(eq(PlanFeaturesModel.planVersionId, version.id));
      await tx
        .delete(PlanAddOnLimitsModel)
        .where(eq(PlanAddOnLimitsModel.planVersionId, version.id));
      await tx
        .delete(PlanVersionModel)
        .where(eq(PlanVersionModel.id, version.id));
      return version;
    });
  }

  /** Stops sales now; after endsAt its clinics renew on the replacement (or choose). Emails each clinic once. */
  static async endPlan(
    planId: string,
    input: { endsAt: Date; replacementPlanId: string | null }
  ) {
    if (input.endsAt.getTime() < Date.now() - 60_000) {
      throw new HttpError(400, 'The end date cannot be in the past.');
    }
    if (input.replacementPlanId === planId) {
      throw new HttpError(400, 'Choose a different plan to move clinics to.');
    }
    let replacementName: string | null = null;
    if (input.replacementPlanId) {
      const [replacement] = await database
        .select({
          name: SubscriptionPlanModel.name,
          isActive: SubscriptionPlanModel.isActive,
          endsAt: SubscriptionPlanModel.endsAt,
        })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, input.replacementPlanId));
      if (!replacement || !replacement.isActive || replacement.endsAt) {
        throw new HttpError(
          400,
          'Clinics can only move to a plan that is on sale.'
        );
      }
      replacementName = replacement.name;
    }
    const [plan] = await database
      .update(SubscriptionPlanModel)
      .set({
        isActive: false,
        endsAt: input.endsAt,
        replacementPlanId: input.replacementPlanId,
        updatedAt: new Date(),
      })
      .where(eq(SubscriptionPlanModel.id, planId))
      .returning();
    if (!plan) throw new HttpError(404, 'Plan not found.');
    const clinics = await PlansService.clinicsOn(planId);
    for (const c of clinics) {
      await subscriptionNotify(
        'subscription.plan_ending',
        {
          clinicId: c.clinicId,
          planName: plan.name,
          endsAt: input.endsAt,
          replacementName,
        },
        `${c.clinicId}|${planId}|${input.endsAt.toISOString()}`
      );
    }
    return { plan, clinics: clinics.length };
  }

  /** Takes back an end that has not happened yet; the plan stays not sold until put on sale. */
  static async undoEnd(planId: string) {
    const [plan] = await database
      .select({ endsAt: SubscriptionPlanModel.endsAt })
      .from(SubscriptionPlanModel)
      .where(eq(SubscriptionPlanModel.id, planId));
    if (!plan) throw new HttpError(404, 'Plan not found.');
    if (!plan.endsAt || plan.endsAt <= new Date()) {
      throw new HttpError(
        409,
        'Only an end that has not happened yet can be undone.'
      );
    }
    await database
      .update(SubscriptionPlanModel)
      .set({ endsAt: null, replacementPlanId: null, updatedAt: new Date() })
      .where(eq(SubscriptionPlanModel.id, planId));
  }

  static async setActive(planId: string, isActive: boolean) {
    if (isActive) {
      const [current] = await database
        .select({ endsAt: SubscriptionPlanModel.endsAt })
        .from(SubscriptionPlanModel)
        .where(eq(SubscriptionPlanModel.id, planId));
      if (current?.endsAt) {
        throw new HttpError(
          409,
          'This plan is ending. Undo the end first, then put it on sale.'
        );
      }
    }
    const [plan] = await database
      .update(SubscriptionPlanModel)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(SubscriptionPlanModel.id, planId))
      .returning();
    if (!plan) throw new HttpError(404, 'Plan not found.');
    return plan;
  }

  static async listPlans(ownerType: OwnerType = 'clinic', at = new Date()) {
    const plans = await database
      .select()
      .from(SubscriptionPlanModel)
      .where(
        and(
          eq(SubscriptionPlanModel.ownerType, ownerType),
          eq(SubscriptionPlanModel.isActive, true)
        )
      );
    if (!plans.length) return [];

    const current = await PlansService.currentVersions(
      plans.map((p) => p.id),
      at
    );
    const versionIds = [...current.values()].map((v) => v.id);
    if (!versionIds.length) return [];

    const [features, addOnLimits] = await Promise.all([
      database
        .select()
        .from(PlanFeaturesModel)
        .where(inArray(PlanFeaturesModel.planVersionId, versionIds))
        .orderBy(asc(PlanFeaturesModel.sortOrder)),
      database
        .select({
          planVersionId: PlanAddOnLimitsModel.planVersionId,
          addOnId: PlanAddOnLimitsModel.addOnId,
          maxCap: PlanAddOnLimitsModel.maxCap,
          featureKey: AddOnModel.featureKey,
          name: AddOnModel.name,
        })
        .from(PlanAddOnLimitsModel)
        .innerJoin(AddOnModel, eq(AddOnModel.id, PlanAddOnLimitsModel.addOnId))
        .where(inArray(PlanAddOnLimitsModel.planVersionId, versionIds)),
    ]);

    // A plan with no version in effect yet is not on sale.
    return plans.flatMap((plan) => {
      const version = current.get(plan.id);
      if (!version) return [];
      return [
        {
          plan,
          version,
          features: PlansService.forSale(
            features.filter((f) => f.planVersionId === version.id)
          ),
          addOnLimits: addOnLimits.filter(
            (l) => l.planVersionId === version.id
          ),
        },
      ];
    });
  }
}
