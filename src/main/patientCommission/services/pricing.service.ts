import { and, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { isUndefinedTable, isUniqueViolation } from '../../../utils/db.utils';
import logger from '../../../utils/logger';
import { getISTDateString, startOfDayIST } from '../../../utils/istDateTime';
import {
  CommissionPricingModel as M,
  type CommissionPricingRow,
} from '../models/commissionPricing.model';
import { getClinicPort } from '../ports';
import type {
  ClinicPricingOverride,
  CommissionPeriodKind,
  CommissionPricing,
  CommissionTier,
  PricingSource,
  PricingVersionRow,
  PricingView,
} from '../types/patientCommission.types';
import type {
  ClinicPricingChange,
  DefaultPricingChange,
} from '../schemas/patientCommission.schema';
import { changeStartDate } from '../utils/commissionPeriod.utils';
import {
  latestVersionAt,
  resolvePricing,
  sortedTiers,
} from '../utils/commissionPricing.utils';

/** Rows read for one scope's history, and for the list of clinic overrides. */
const SCOPE_ROWS_MAX = 100;
const OVERRIDE_ROWS_MAX = 1000;

const scopeOf = (clinicId: string | null) =>
  clinicId ? eq(M.clinicId, clinicId) : isNull(M.clinicId);

const toVersion = (row: CommissionPricingRow): PricingVersionRow => ({
  clinicId: row.clinicId,
  periodKind: row.periodKind,
  tiers: row.tiers,
  effectiveFrom: row.effectiveFrom,
});

/** The pricing a row sets; null for a clinic row that follows the platform default. */
const pricingOf = (row: PricingVersionRow): CommissionPricing | null =>
  row.periodKind && row.tiers?.length
    ? { periodKind: row.periodKind, tiers: sortedTiers(row.tiers) }
    : null;

/** Rupee tiers from the request become paise tiers, the only form stored. */
const toPaiseTiers = (
  tiers: { fromPatients: number; ratePerPatient: number }[]
): CommissionTier[] =>
  tiers.map((t) => ({
    fromPatients: t.fromPatients,
    ratePaise: Math.round(t.ratePerPatient * 100),
  }));

const earliest = (rows: CommissionPricingRow[]) =>
  [...rows].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
  )[0];

/** Super Admin's per-patient pricing: the platform default, clinic overrides, and which one applies when. */
export class PricingService {
  /** The pricing a clinic is on at `at`: its own if set, else the platform default (`null` = default only). */
  static async resolveFor(
    clinicId: string | null,
    at: Date
  ): Promise<{ pricing: CommissionPricing; source: PricingSource }> {
    const newest = (scope: ReturnType<typeof scopeOf>) =>
      database
        .select()
        .from(M)
        .where(and(scope, lte(M.effectiveFrom, at)))
        .orderBy(desc(M.effectiveFrom))
        .limit(1);
    try {
      const [own, platform] = await Promise.all([
        clinicId ? newest(scopeOf(clinicId)) : Promise.resolve([]),
        newest(scopeOf(null)),
      ]);
      return resolvePricing(own.map(toVersion), platform.map(toVersion), at);
    } catch (error) {
      // No pricing can be saved before its table exists, so the built-in default is the right price.
      if (!isUndefinedTable(error)) throw error;
      logger.warn(
        '[PatientCommission] Pricing table is not migrated yet; using the default pricing.'
      );
      return resolvePricing([], [], at);
    }
  }

  /** One scope as Super Admin sees it: in force now, a change waiting for the next period, and the history. */
  static async view(
    clinicId: string | null,
    historyLimit = 20
  ): Promise<PricingView> {
    const now = new Date();
    const [rows, resolved] = await Promise.all([
      database
        .select()
        .from(M)
        .where(scopeOf(clinicId))
        .orderBy(desc(M.effectiveFrom))
        .limit(SCOPE_ROWS_MAX),
      PricingService.resolveFor(clinicId, now),
    ]);
    const pending = earliest(rows.filter((r) => r.effectiveFrom > now));
    const pendingPricing = pending ? pricingOf(toVersion(pending)) : null;
    const names = await getClinicPort().getUserNames(
      rows.map((r) => r.changedBy)
    );
    return {
      clinicId,
      source: resolved.source,
      inForce: resolved.pricing,
      scheduled: pending
        ? {
            ...(pendingPricing ?? resolved.pricing),
            effectiveFrom: pending.effectiveFrom.toISOString(),
            followsDefault: !pendingPricing,
          }
        : null,
      history: rows.slice(0, historyLimit).map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom.toISOString(),
        followsDefault: !pricingOf(toVersion(r)),
        periodKind: r.periodKind,
        tiers: r.tiers ? sortedTiers(r.tiers) : null,
        reason: r.reason,
        changedBy: names.get(r.changedBy) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Every clinic with pricing of its own, now or waiting to start, by clinic name. */
  static async listOverrides(): Promise<ClinicPricingOverride[]> {
    const now = new Date();
    const rows = await database
      .select()
      .from(M)
      .where(isNotNull(M.clinicId))
      .orderBy(desc(M.effectiveFrom))
      .limit(OVERRIDE_ROWS_MAX);
    const byClinic = new Map<string, CommissionPricingRow[]>();
    for (const row of rows) {
      byClinic.set(row.clinicId!, [...(byClinic.get(row.clinicId!) ?? []), row]);
    }
    const found: Omit<ClinicPricingOverride, 'clinicName'>[] = [];
    for (const [clinicId, list] of byClinic) {
      const latest = latestVersionAt(list.map(toVersion), now);
      const current = latest ? pricingOf(latest) : null;
      const next = earliest(list.filter((r) => r.effectiveFrom > now));
      const scheduled = next
        ? {
            effectiveFrom: next.effectiveFrom.toISOString(),
            followsDefault: !pricingOf(toVersion(next)),
            pricing: pricingOf(toVersion(next)),
          }
        : null;
      // A clinic that follows the default and has nothing new waiting is not an override.
      if (!current && !(scheduled && !scheduled.followsDefault)) continue;
      found.push({ clinicId, current, scheduled });
    }
    const names = await getClinicPort().getClinicNames(
      found.map((f) => f.clinicId)
    );
    return found
      .map((f) => ({
        ...f,
        clinicName: names.get(f.clinicId) ?? 'Unnamed clinic',
      }))
      .sort((a, b) => a.clinicName.localeCompare(b.clinicName));
  }

  /** Saves a new platform default; it starts with the next billing period. */
  static async changeDefault(input: DefaultPricingChange, byUserId: string) {
    await PricingService.write(
      null,
      { periodKind: input.periodKind, tiers: toPaiseTiers(input.tiers) },
      input.reason,
      byUserId
    );
    return PricingService.view(null);
  }

  /** Gives a clinic its own pricing, or sends it back to the platform default, from the next billing period. */
  static async changeClinic(
    clinicId: string,
    input: ClinicPricingChange,
    byUserId: string
  ) {
    const values = input.useDefault
      ? { periodKind: null, tiers: null }
      : { periodKind: input.periodKind, tiers: toPaiseTiers(input.tiers) };
    await PricingService.write(clinicId, values, input.reason, byUserId);
    return PricingService.view(clinicId);
  }

  /** Writes a version starting at the next period boundary; a change still waiting to start is replaced by it. */
  private static async write(
    clinicId: string | null,
    values: { periodKind: CommissionPeriodKind | null; tiers: CommissionTier[] | null },
    reason: string,
    byUserId: string
  ) {
    const now = new Date();
    const current = (await PricingService.resolveFor(clinicId, now)).pricing
      .periodKind;
    // A clinic going back to the default takes on the default's period length.
    const target =
      values.periodKind ??
      (await PricingService.resolveFor(null, now)).pricing.periodKind;
    const effectiveFrom = startOfDayIST(
      changeStartDate(getISTDateString(now), current, target)
    );
    try {
      await database.transaction(async (tx) => {
        await tx
          .delete(M)
          .where(and(scopeOf(clinicId), gt(M.effectiveFrom, now)));
        await tx.insert(M).values({
          clinicId,
          ...values,
          effectiveFrom,
          reason,
          changedBy: byUserId,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(
          409,
          'Another change for this period was saved at the same time. Please try again.'
        );
      }
      throw error;
    }
  }
}
