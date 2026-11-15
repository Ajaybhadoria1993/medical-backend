import { asc, desc, eq, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../../utils/cache.util';
import logger from '../../../../utils/logger';
import { CreditSettingsModel } from '../../models/creditSettings.model';
import { getClinicPort } from '../../ports';
import type { CreditSettingValues } from '../../types/credits.types';
import type { SettingsChangeBody } from '../../types/requests.types';
import {
  CREDIT_TYPES,
  DEFAULT_CREDIT_SETTINGS,
  type CreditType,
} from '../../utils/creditTypes.utils';

const SETTINGS_TTL_SECONDS = 300;

type SettingsRow = typeof CreditSettingsModel.$inferSelect;

/** Adds who made each change; null changedBy is the seeded defaults. */
async function withChangedByName(rows: SettingsRow[]) {
  const ids = [
    ...new Set(rows.map((r) => r.changedBy).filter((id): id is string => !!id)),
  ];
  const names = await getClinicPort().getUserNames(ids);
  return rows.map((r) => ({
    ...r,
    changedByName: r.changedBy
      ? (names.get(r.changedBy) ?? 'Removed user')
      : 'System default',
  }));
}
// Allows for clock skew and form-to-submit delay when "now" is sent explicitly.
const PAST_TOLERANCE_MS = 5 * 60 * 1000;

type CachedRow = CreditSettingValues & { effectiveFrom: string };

export class CreditSettingsService {
  /** The settings in force at `now`: the latest row that has started.
   *  Falls back to the built-in defaults when the seed has not run. */
  static async getInForce(
    creditType: CreditType,
    now: Date = new Date()
  ): Promise<CreditSettingValues> {
    // All rows are cached, so a scheduled change takes effect on time without a shorter TTL.
    const rows = await getOrSetCache<CachedRow[]>(
      CacheKeys.creditSettings(creditType),
      SETTINGS_TTL_SECONDS,
      () => this.loadRows(creditType)
    );

    const started = rows.filter(
      (row) => new Date(row.effectiveFrom).getTime() <= now.getTime()
    );
    const inForce = started[started.length - 1];
    if (!inForce) return DEFAULT_CREDIT_SETTINGS[creditType];

    const { effectiveFrom: _from, ...values } = inForce;
    return values;
  }

  /** The version in force now and any scheduled after it, with who and why (Super Admin view). */
  static async current(creditType: CreditType) {
    const rows = await database
      .select()
      .from(CreditSettingsModel)
      .where(eq(CreditSettingsModel.creditType, creditType))
      .orderBy(asc(CreditSettingsModel.effectiveFrom));

    const named = await withChangedByName(rows);
    const now = Date.now();
    const started = named.filter((r) => r.effectiveFrom.getTime() <= now);
    return {
      inForce: started[started.length - 1] ?? null,
      scheduled: named.filter((r) => r.effectiveFrom.getTime() > now),
    };
  }

  /** Every version, newest first. */
  static async history(
    creditType: CreditType,
    pageNumber: number,
    pageSize: number
  ) {
    const where = eq(CreditSettingsModel.creditType, creditType);
    const [items, [count]] = await Promise.all([
      database
        .select()
        .from(CreditSettingsModel)
        .where(where)
        .orderBy(desc(CreditSettingsModel.effectiveFrom))
        .limit(pageSize)
        .offset((pageNumber - 1) * pageSize),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(CreditSettingsModel)
        .where(where),
    ]);
    return {
      items: await withChangedByName(items),
      total: count?.total ?? 0,
      pageNumber,
      pageSize,
    };
  }

  /** Adds a new version; old ones stay as history. Starts now, or later to schedule it. */
  static async change(
    creditType: CreditType,
    body: SettingsChangeBody,
    actorUserId: string
  ) {
    const effectiveFrom = body.effectiveFrom
      ? new Date(body.effectiveFrom)
      : new Date();
    if (effectiveFrom.getTime() < Date.now() - PAST_TOLERANCE_MS) {
      throw new HttpError(
        422,
        'A change can start now or later, not in the past'
      );
    }

    let row;
    try {
      [row] = await database
        .insert(CreditSettingsModel)
        .values({
          creditType,
          expiryDays: body.expiryDays,
          reminderDays: body.reminderDays,
          warnPercent: body.warnPercent,
          unitCostInr: body.unitCostInr,
          taxPercent: body.taxPercent,
          effectiveFrom,
          changedBy: actorUserId,
          reason: body.reason,
        })
        .returning();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'Another change already starts at that time');
      }
      throw err;
    }

    await invalidateCache(CacheKeys.creditSettings(creditType));
    logger.info(
      `[Credits] ${creditType} settings changed by ${actorUserId}, from ${effectiveFrom.toISOString()}`
    );
    return row;
  }

  /** Adds the default settings for any credit type that has none; safe to rerun.
   *  Returns how many types were seeded. */
  static async seedDefaults(): Promise<number> {
    let seeded = 0;

    for (const creditType of CREDIT_TYPES) {
      const [existing] = await database
        .select({ id: CreditSettingsModel.id })
        .from(CreditSettingsModel)
        .where(eq(CreditSettingsModel.creditType, creditType))
        .limit(1);
      if (existing) continue;

      await database.insert(CreditSettingsModel).values({
        creditType,
        ...DEFAULT_CREDIT_SETTINGS[creditType],
        effectiveFrom: new Date(),
        changedBy: null,
        reason: 'Initial defaults',
      });
      seeded += 1;
    }

    return seeded;
  }

  private static async loadRows(creditType: CreditType): Promise<CachedRow[]> {
    const rows = await database
      .select({
        expiryDays: CreditSettingsModel.expiryDays,
        reminderDays: CreditSettingsModel.reminderDays,
        warnPercent: CreditSettingsModel.warnPercent,
        unitCostInr: CreditSettingsModel.unitCostInr,
        taxPercent: CreditSettingsModel.taxPercent,
        effectiveFrom: CreditSettingsModel.effectiveFrom,
      })
      .from(CreditSettingsModel)
      .where(eq(CreditSettingsModel.creditType, creditType))
      .orderBy(asc(CreditSettingsModel.effectiveFrom));

    return rows.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom.toISOString(),
    }));
  }
}
