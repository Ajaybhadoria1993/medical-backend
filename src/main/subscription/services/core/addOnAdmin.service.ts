import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { CacheKeys, invalidateCacheMany } from '../../../../utils/cache.util';
import { AddOnModel } from '../../models/addon.model';
import { AddOnPriceModel, addOnPriceNow } from '../../models/addOnPrice.model';

// Clinic billing pages read add-on prices from this cache.
const clearCatalog = () =>
  invalidateCacheMany([CacheKeys.addOnCatalog, CacheKeys.allPlans]);

/** Super Admin add-ons: wording, on sale or not, and prices that change from a date. */
export class AddOnAdminService {
  /** Every add-on with its price now, the next scheduled change, and how widely it is used. */
  static async list() {
    const now = new Date();
    const [rows, next] = await Promise.all([
      database
        .select({
          id: AddOnModel.id,
          name: AddOnModel.name,
          description: AddOnModel.description,
          featureKey: AddOnModel.featureKey,
          unitValue: AddOnModel.unitValue,
          isActive: AddOnModel.isActive,
          monthlyPrice: addOnPriceNow('monthly'),
          yearlyPrice: addOnPriceNow('yearly'),
          plans: sql<number>`(select count(distinct l.plan_id)::int from plan_add_on_limits l where l.add_on_id = "add_ons"."id")`,
          clinics: sql<number>`(select count(distinct s.owner_id)::int from subscription_add_ons s where s.add_on_id = "add_ons"."id" and s.status = 'active')`,
        })
        .from(AddOnModel)
        .orderBy(asc(AddOnModel.name)),
      database
        .select()
        .from(AddOnPriceModel)
        .where(gt(AddOnPriceModel.effectiveFrom, now))
        .orderBy(asc(AddOnPriceModel.effectiveFrom)),
    ]);
    return rows.map((r) => ({
      ...r,
      monthlyPrice: Number(r.monthlyPrice),
      yearlyPrice: Number(r.yearlyPrice),
      nextPrice: next.find((p) => p.addOnId === r.id) ?? null,
    }));
  }

  /** Price changes for one add-on, newest first. */
  static async prices(addOnId: string) {
    return database
      .select()
      .from(AddOnPriceModel)
      .where(eq(AddOnPriceModel.addOnId, addOnId))
      .orderBy(desc(AddOnPriceModel.effectiveFrom));
  }

  static async update(
    addOnId: string,
    input: { name?: string; description?: string | null; isActive?: boolean }
  ) {
    const [row] = await database
      .update(AddOnModel)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(AddOnModel.id, addOnId))
      .returning();
    if (!row) throw new HttpError(404, 'Add-on not found.');
    await clearCatalog();
    return row;
  }

  /** From `effectiveFrom`, new purchases and renewals pay the new price; earlier ones keep the old. */
  static async schedulePrice(
    addOnId: string,
    input: { monthlyPrice: number; yearlyPrice: number; effectiveFrom: Date },
    createdBy: string | null
  ) {
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new HttpError(400, 'The start date cannot be in the past.');
    }
    const [addOn] = await database
      .select({ id: AddOnModel.id })
      .from(AddOnModel)
      .where(eq(AddOnModel.id, addOnId));
    if (!addOn) throw new HttpError(404, 'Add-on not found.');
    const [clash] = await database
      .select({ id: AddOnPriceModel.id })
      .from(AddOnPriceModel)
      .where(
        and(
          eq(AddOnPriceModel.addOnId, addOnId),
          gt(AddOnPriceModel.effectiveFrom, new Date())
        )
      )
      .limit(1);
    if (clash) {
      throw new HttpError(
        409,
        'A price change is already scheduled. Cancel it first, then schedule the new one.'
      );
    }
    const [price] = await database
      .insert(AddOnPriceModel)
      .values({
        addOnId,
        monthlyPrice: String(input.monthlyPrice),
        yearlyPrice: String(input.yearlyPrice),
        effectiveFrom: input.effectiveFrom,
        createdBy,
      })
      .returning();
    await clearCatalog();
    return price!;
  }

  /** Only a change that has not started can be cancelled; a started one is history. */
  static async cancelPrice(addOnId: string, priceId: string) {
    const [row] = await database
      .delete(AddOnPriceModel)
      .where(
        and(
          eq(AddOnPriceModel.id, priceId),
          eq(AddOnPriceModel.addOnId, addOnId),
          gt(AddOnPriceModel.effectiveFrom, new Date())
        )
      )
      .returning({ id: AddOnPriceModel.id });
    if (!row) {
      throw new HttpError(
        409,
        'Only a price change that has not started can be cancelled.'
      );
    }
    await clearCatalog();
  }
}
