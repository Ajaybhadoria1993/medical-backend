import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { UserModel } from '../../users/models/user.model';
import { DynamicSplitEngine } from '../engine/dynamicSplit.engine';
import type { IFeeConfig } from '../interfaces/splitEngine.types';
import { FeeConfigVersionModel as F } from '../models/feeConfigVersion.model';
import type {
  FeeMethod,
  FeeSaveInput,
  FeeType,
  FeeValue,
} from '../interfaces/feeConfig.types';
import {
  FEE_BASE as BASE,
  FEE_LIMITS,
  FEE_PRIORITY as PRIORITY,
  FEE_TYPES,
} from '../utils/feeConfig.utils';

/** Platform fees on online bookings: default for all clinics, optionally a clinic's own, kept as versions. */
export class FeeConfigVersionService {
  /** Rows of the default fees, or of one clinic's own. */
  private static scopeOf(clinicId: string | null) {
    return clinicId
      ? and(eq(F.scope, 'CLINIC'), eq(F.clinicId, clinicId))
      : and(eq(F.scope, 'GLOBAL'), isNull(F.clinicId));
  }

  /** Each fee as a clinic pays it now (its own or the default), plus any change already scheduled. */
  static async current(clinicId: string | null, at = new Date()) {
    const rows = await database
      .select()
      .from(F)
      .where(
        and(
          eq(F.isActive, true),
          clinicId
            ? or(isNull(F.clinicId), eq(F.clinicId, clinicId))
            : isNull(F.clinicId),
          or(isNull(F.effectiveTo), gt(F.effectiveTo, at))
        )
      )
      .orderBy(desc(F.version));
    return FEE_TYPES.map((feeType) => {
      const pick = (live: boolean) => {
        const of = (own: boolean) =>
          rows.find(
            (r) =>
              r.feeType === feeType &&
              (own ? r.clinicId === clinicId : r.clinicId === null) &&
              (live ? r.effectiveFrom <= at : r.effectiveFrom > at)
          );
        return (clinicId ? of(true) : undefined) ?? of(false);
      };
      const now = pick(true);
      const next = pick(false);
      return {
        feeType,
        source: now?.clinicId ? ('clinic' as const) : ('default' as const),
        method: (now?.calculationMethod ?? 'PERCENTAGE') as FeeMethod,
        amount: Number(now?.rateOrAmount ?? 0),
        enabled: now?.enabled ?? false,
        taxRate: Number(now?.taxRate ?? 18),
        effectiveFrom: now?.effectiveFrom ?? null,
        scheduled: next
          ? {
              method: next.calculationMethod as FeeMethod,
              amount: Number(next.rateOrAmount),
              enabled: next.enabled,
              effectiveFrom: next.effectiveFrom,
            }
          : null,
      };
    });
  }

  /** Clinics that have their own fees now or scheduled, for the Super Admin list. */
  static async clinicsWithOwnFees() {
    const rows = await database
      .selectDistinct({ clinicId: F.clinicId })
      .from(F)
      .where(
        and(
          eq(F.scope, 'CLINIC'),
          eq(F.isActive, true),
          or(isNull(F.effectiveTo), gt(F.effectiveTo, new Date()))
        )
      );
    return rows.map((r) => r.clinicId).filter((id): id is string => !!id);
  }

  /** Refuses a value outside the safety limits, before anything is saved. */
  static check(feeType: FeeType, method: FeeMethod, amount: number) {
    const max = FEE_LIMITS[feeType][method];
    if (max === null)
      throw new HttpError(
        422,
        `${feeType === 'GATEWAY_FEE' ? 'Gateway fee' : 'This fee'} can only be a percentage`
      );
    if (!(amount >= 0) || amount > max)
      throw new HttpError(
        422,
        method === 'PERCENTAGE' ? `Maximum is ${max}%` : `Maximum is ₹${max}`
      );
  }

  /** A new version: the one covering its start is closed there, a later scheduled one is replaced. */
  static async save(input: FeeSaveInput): Promise<typeof F.$inferSelect> {
    this.check(input.feeType, input.method, input.amount);
    const from =
      input.effectiveFrom && input.effectiveFrom > new Date()
        ? input.effectiveFrom
        : new Date();
    const where = and(
      this.scopeOf(input.clinicId),
      eq(F.feeType, input.feeType)
    );

    return database.transaction(async (tx) => {
      // One save at a time per fee and scope, so two Super Admins can't both close the same row.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`fees:${input.clinicId ?? 'global'}:${input.feeType}`}))`
      );
      const open = await tx
        .select()
        .from(F)
        .where(
          and(
            where,
            eq(F.isActive, true),
            or(isNull(F.effectiveTo), gt(F.effectiveTo, from))
          )
        );
      for (const r of open) {
        if (r.effectiveFrom >= from)
          await tx.update(F).set({ isActive: false }).where(eq(F.id, r.id));
        else
          await tx.update(F).set({ effectiveTo: from }).where(eq(F.id, r.id));
      }
      const [{ v }] = await tx
        .select({ v: sql<number>`coalesce(max(${F.version}), 0)::int` })
        .from(F)
        .where(where);
      const [row] = await tx
        .insert(F)
        .values({
          scope: input.clinicId ? 'CLINIC' : 'GLOBAL',
          clinicId: input.clinicId,
          version: v + 1,
          feeType: input.feeType,
          enabled: input.enabled,
          calculationMethod: input.method,
          calculationBase: BASE[input.feeType],
          rateOrAmount: input.amount.toFixed(4),
          taxRate: '18.00',
          taxTreatment: 'TAX_EXCLUSIVE',
          deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
          isActive: true,
          effectiveFrom: from,
          createdBy: input.actorId,
        })
        .returning();
      return row;
    });
  }

  /** The clinic goes back to the default fees from now; its scheduled changes are dropped. */
  static async resetClinic(clinicId: string): Promise<number> {
    const now = new Date();
    return database.transaction(async (tx) => {
      const open = await tx
        .select({ id: F.id, effectiveFrom: F.effectiveFrom })
        .from(F)
        .where(
          and(
            this.scopeOf(clinicId),
            eq(F.isActive, true),
            or(isNull(F.effectiveTo), gt(F.effectiveTo, now))
          )
        );
      for (const r of open)
        await tx
          .update(F)
          .set(
            r.effectiveFrom > now ? { isActive: false } : { effectiveTo: now }
          )
          .where(eq(F.id, r.id));
      return open.length;
    });
  }

  /** Every version of the default or a clinic's own fees, newest first, with who saved it. */
  static async history(clinicId: string | null) {
    return database
      .select({
        id: F.id,
        feeType: F.feeType,
        version: F.version,
        method: F.calculationMethod,
        amount: F.rateOrAmount,
        enabled: F.enabled,
        isActive: F.isActive,
        effectiveFrom: F.effectiveFrom,
        effectiveTo: F.effectiveTo,
        createdAt: F.createdAt,
        createdByName: UserModel.name,
      })
      .from(F)
      .leftJoin(UserModel, eq(UserModel.id, F.createdBy))
      .where(this.scopeOf(clinicId))
      .orderBy(desc(F.createdAt))
      .limit(100);
  }

  /** What a patient pays on a price with these fees, worked out by the booking engine itself. */
  static preview(price: number, fees: FeeValue[]) {
    const configs: IFeeConfig[] = fees.map((f) => ({
      feeName: f.feeType.toLowerCase(),
      feeType: f.feeType,
      enabled: f.enabled,
      calculationMethod: f.method,
      calculationBase: BASE[f.feeType] as IFeeConfig['calculationBase'],
      rateOrAmount: f.amount,
      taxRate: 18,
      taxTreatment: 'TAX_EXCLUSIVE',
      priority: PRIORITY[f.feeType],
      effectiveFrom: new Date(),
    }));
    return DynamicSplitEngine.calculate(price, configs);
  }
}
