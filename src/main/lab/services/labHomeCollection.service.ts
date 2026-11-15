import { and, asc, count, eq, gt, lt, ne, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  LabUpdatedHomeCollectionModel,
  type labHomeCollectionUnitEnum,
} from '../models/labUpdated.model';
import type {
  CreateLabHomeCollectionInput,
  GetLabHomeCollectionsQueryInput,
  UpdateLabHomeCollectionInput,
} from '../schemas/labHomeCollection.schemas';
import {
  LabCatalogContext,
  pageMeta,
  pagination,
  verifyLabAccess,
} from './labCatalog.service';

type LabHomeCollectionUnit =
  (typeof labHomeCollectionUnitEnum.enumValues)[number];

const formatRate = (
  rate: typeof LabUpdatedHomeCollectionModel.$inferSelect
) => ({
  ...rate,
  fromRange: Number(rate.fromRange),
  toRange: Number(rate.toRange),
});

const ensureValidRange = (fromRange: number, toRange: number) => {
  if (toRange <= fromRange) {
    throw new HttpError(400, 'toRange must be greater than fromRange');
  }
};

export class LabHomeCollectionService {
  private static async ensureNoOverlappingActiveRate(
    trx: Parameters<Parameters<typeof database.transaction>[0]>[0],
    labId: string,
    unit: LabHomeCollectionUnit,
    fromRange: number,
    toRange: number,
    rateId?: string
  ) {
    const conditions: SQL[] = [
      eq(LabUpdatedHomeCollectionModel.labId, labId),
      eq(LabUpdatedHomeCollectionModel.unit, unit),
      eq(LabUpdatedHomeCollectionModel.isActive, true),
      lt(LabUpdatedHomeCollectionModel.fromRange, String(toRange)),
      gt(LabUpdatedHomeCollectionModel.toRange, String(fromRange)),
    ];

    if (rateId) {
      conditions.push(ne(LabUpdatedHomeCollectionModel.id, rateId));
    }

    const [existing] = await trx
      .select({ id: LabUpdatedHomeCollectionModel.id })
      .from(LabUpdatedHomeCollectionModel)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      throw new HttpError(
        409,
        'The distance range overlaps an existing active range for this lab'
      );
    }
  }

  static async addPricing(
    payload: CreateLabHomeCollectionInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      ensureValidRange(payload.fromRange, payload.toRange);

      if (payload.isActive) {
        await this.ensureNoOverlappingActiveRate(
          trx,
          context.labId,
          payload.unit,
          payload.fromRange,
          payload.toRange
        );
      }

      const [rate] = await trx
        .insert(LabUpdatedHomeCollectionModel)
        .values({
          labId: context.labId,
          fromRange: String(payload.fromRange),
          toRange: String(payload.toRange),
          unit: payload.unit,
          price: payload.price,
          isActive: payload.isActive,
        })
        .returning();

      return formatRate(rate);
    });
  }

  static async getPricing(
    query: GetLabHomeCollectionsQueryInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const { page, limit, offset } = pagination(query);
      const conditions: SQL[] = [
        eq(LabUpdatedHomeCollectionModel.labId, context.labId),
      ];

      if (query.unit) {
        conditions.push(eq(LabUpdatedHomeCollectionModel.unit, query.unit));
      }
      if (query.isActive !== undefined) {
        conditions.push(
          eq(LabUpdatedHomeCollectionModel.isActive, query.isActive)
        );
      }

      const where = and(...conditions);
      const [{ total }] = await trx
        .select({ total: count() })
        .from(LabUpdatedHomeCollectionModel)
        .where(where);

      const rates = await trx
        .select()
        .from(LabUpdatedHomeCollectionModel)
        .where(where)
        .orderBy(
          asc(LabUpdatedHomeCollectionModel.unit),
          asc(LabUpdatedHomeCollectionModel.fromRange),
          asc(LabUpdatedHomeCollectionModel.toRange)
        )
        .limit(limit)
        .offset(offset);

      return {
        rates: rates.map(formatRate),
        pagination: pageMeta(Number(total ?? 0), page, limit),
      };
    });
  }

  static async updatePricing(
    rateId: string,
    payload: UpdateLabHomeCollectionInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [existing] = await trx
        .select()
        .from(LabUpdatedHomeCollectionModel)
        .where(
          and(
            eq(LabUpdatedHomeCollectionModel.id, rateId),
            eq(LabUpdatedHomeCollectionModel.labId, context.labId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new HttpError(404, 'Home collection pricing not found');
      }

      const fromRange = payload.fromRange ?? Number(existing.fromRange);
      const toRange = payload.toRange ?? Number(existing.toRange);
      const unit = payload.unit ?? existing.unit;
      const isActive = payload.isActive ?? existing.isActive;

      ensureValidRange(fromRange, toRange);

      if (isActive) {
        await this.ensureNoOverlappingActiveRate(
          trx,
          context.labId,
          unit,
          fromRange,
          toRange,
          rateId
        );
      }

      const [updated] = await trx
        .update(LabUpdatedHomeCollectionModel)
        .set({
          ...(payload.fromRange !== undefined
            ? { fromRange: String(payload.fromRange) }
            : {}),
          ...(payload.toRange !== undefined
            ? { toRange: String(payload.toRange) }
            : {}),
          ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
          ...(payload.price !== undefined ? { price: payload.price } : {}),
          ...(payload.isActive !== undefined
            ? { isActive: payload.isActive }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(LabUpdatedHomeCollectionModel.id, rateId))
        .returning();

      return formatRate(updated);
    });
  }
}
