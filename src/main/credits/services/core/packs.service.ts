import { and, asc, eq } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import logger from '../../../../utils/logger';
import { CreditPackModel } from '../../models/creditPacks.model';
import { getClinicPort } from '../../ports';
import type {
  PackCreateBody,
  PackUpdateBody,
} from '../../types/requests.types';
import {
  CREDIT_TYPES,
  DEFAULT_CREDIT_PACKS,
  type CreditType,
} from '../../utils/creditTypes.utils';

const isDuplicate = (err: unknown) =>
  (err as { code?: string }).code === '23505';

/** Super Admin's credit packs per credit type: list, add, edit, switch on/off. */
export class PacksService {
  /** Every pack, switched-off ones included, in display order. */
  static async list(creditType: CreditType) {
    const rows = await database
      .select()
      .from(CreditPackModel)
      .where(eq(CreditPackModel.creditType, creditType))
      .orderBy(asc(CreditPackModel.sortOrder), asc(CreditPackModel.credits));

    const ids = [
      ...new Set(
        rows.map((r) => r.changedBy).filter((id): id is string => !!id)
      ),
    ];
    const names = await getClinicPort().getUserNames(ids);
    return rows.map((r) => ({
      ...r,
      changedByName: r.changedBy
        ? (names.get(r.changedBy) ?? 'Removed user')
        : 'System default',
    }));
  }

  /** Packs a clinic can buy now, cheapest first. */
  static async onSale(creditType: CreditType) {
    return database
      .select({
        id: CreditPackModel.id,
        creditType: CreditPackModel.creditType,
        credits: CreditPackModel.credits,
        priceInr: CreditPackModel.priceInr,
      })
      .from(CreditPackModel)
      .where(
        and(
          eq(CreditPackModel.creditType, creditType),
          eq(CreditPackModel.active, true)
        )
      )
      .orderBy(asc(CreditPackModel.sortOrder), asc(CreditPackModel.credits));
  }

  /** One pack, only while it is on sale; its price and credits are copied into the purchase. */
  static async forSale(packId: string) {
    const [pack] = await database
      .select()
      .from(CreditPackModel)
      .where(
        and(eq(CreditPackModel.id, packId), eq(CreditPackModel.active, true))
      )
      .limit(1);
    if (!pack)
      throw new HttpError(
        404,
        'This pack is no longer sold. Please choose another.'
      );
    return pack;
  }

  static async create(
    creditType: CreditType,
    body: PackCreateBody,
    actorUserId: string
  ) {
    try {
      const [row] = await database
        .insert(CreditPackModel)
        .values({ creditType, ...body, changedBy: actorUserId })
        .returning();
      logger.info(
        `[Credits] ${creditType} pack of ${body.credits} added by ${actorUserId}`
      );
      return row;
    } catch (err) {
      if (isDuplicate(err))
        throw new HttpError(
          409,
          `A ${body.credits}-credit pack already exists`
        );
      throw err;
    }
  }

  static async update(
    creditType: CreditType,
    packId: string,
    body: PackUpdateBody,
    actorUserId: string
  ) {
    let row;
    try {
      [row] = await database
        .update(CreditPackModel)
        .set({ ...body, changedBy: actorUserId, updatedAt: new Date() })
        .where(
          and(
            eq(CreditPackModel.id, packId),
            eq(CreditPackModel.creditType, creditType)
          )
        )
        .returning();
    } catch (err) {
      if (isDuplicate(err))
        throw new HttpError(
          409,
          `A ${body.credits}-credit pack already exists`
        );
      throw err;
    }
    if (!row) throw new HttpError(404, 'Credit pack not found');
    logger.info(
      `[Credits] ${creditType} pack ${packId} changed by ${actorUserId}`
    );
    return row;
  }

  /** Adds the default packs for any credit type that has none; safe to rerun. */
  static async seedDefaults(): Promise<number> {
    let seeded = 0;
    for (const creditType of CREDIT_TYPES) {
      const [existing] = await database
        .select({ id: CreditPackModel.id })
        .from(CreditPackModel)
        .where(eq(CreditPackModel.creditType, creditType))
        .limit(1);
      if (existing) continue;

      await database.insert(CreditPackModel).values(
        DEFAULT_CREDIT_PACKS[creditType].map((pack, i) => ({
          creditType,
          ...pack,
          sortOrder: i,
          changedBy: null,
          reason: 'Initial defaults',
        }))
      );
      seeded += 1;
    }
    return seeded;
  }
}
