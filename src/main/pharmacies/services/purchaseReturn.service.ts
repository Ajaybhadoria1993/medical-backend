import { and, between, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { CreatePurchaseReturnInput } from '../schemas/purchaseReturn.schema';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import { PharmacySalesReturnItemsModel } from '../models/pharmacySalesReturn.model';
import {
  PharmacyPurchaseReturnItemsModel,
  PharmacyPurchaseReturnModel,
} from '../models/pharmacyPurchaseReturn.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import { PharmacyStockService } from './stock.service';

export class PharmacyPurchaseReturnService {
  private static roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  static async createPurchaseReturn(
    payload: CreatePurchaseReturnInput,
    pharmacyId: string,
    userId: string
  ) {
    const affectedMedicineIds = new Set<string>();

    const result = await database.transaction(async (tx) => {
      const [pharmacy] = await tx
        .select({ id: PharmacyModel.id })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.isDeleted, false)
          )
        )
        .limit(1);

      if (!pharmacy) {
        throw new HttpError(404, 'Pharmacy not found');
      }

      const [stock] = await tx
        .select({ id: PharmacyStockModel.id })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.id, payload.stockId),
            eq(PharmacyStockModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!stock) {
        throw new HttpError(404, 'Purchase not found');
      }

      const stockMedicineIds = payload.items.map(
        (item) => item.stockMedicineId
      );
      const uniqueStockMedicineIds = [...new Set(stockMedicineIds)];

      if (stockMedicineIds.length !== uniqueStockMedicineIds.length) {
        throw new HttpError(400, 'Duplicate stock medicine is not allowed');
      }

      const stockMedicines = await tx
        .select({
          id: PharmacyStockMedicineModel.id,
          pharmacyStockId: PharmacyStockMedicineModel.pharmacyStockId,
          quantity: PharmacyStockMedicineModel.quantity,
          cost: PharmacyStockMedicineModel.cost,
          batch: PharmacyStockMedicineModel.batch,
          pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
          medicineName: pharmacyMedicineModel.medicineName,
          packOf: pharmacyMedicineModel.packOf,
        })
        .from(PharmacyStockMedicineModel)
        .leftJoin(
          pharmacyMedicineModel,
          eq(
            PharmacyStockMedicineModel.pharmacyMedicineId,
            pharmacyMedicineModel.id
          )
        )
        .where(
          and(
            eq(PharmacyStockMedicineModel.pharmacyStockId, payload.stockId),
            inArray(PharmacyStockMedicineModel.id, uniqueStockMedicineIds)
          )
        )
        .for('update', { of: PharmacyStockMedicineModel });

      if (stockMedicines.length !== uniqueStockMedicineIds.length) {
        throw new HttpError(
          400,
          'One or more stock medicines do not belong to this purchase'
        );
      }

      const medicineIds = [
        ...new Set(stockMedicines.map((item) => item.pharmacyMedicineId)),
      ];

      const tagsRows =
        medicineIds.length > 0
          ? await tx
              .select({
                medicineId: PharmacyTagsMapModel.medicineId,
                tag: PharmacyMedicineTagsModel.tag,
              })
              .from(PharmacyTagsMapModel)
              .innerJoin(
                PharmacyMedicineTagsModel,
                eq(PharmacyTagsMapModel.tagId, PharmacyMedicineTagsModel.id)
              )
              .where(inArray(PharmacyTagsMapModel.medicineId, medicineIds))
          : [];

      const tagsByMedicineId = new Map<string, string[]>();
      for (const row of tagsRows) {
        if (!row.tag) continue;
        const list = tagsByMedicineId.get(row.medicineId) || [];
        list.push(row.tag);
        tagsByMedicineId.set(row.medicineId, list);
      }

      const soldRows = await tx
        .select({
          stockMedicineId: PharmacySalesItemsModel.pharmacyStockMedicineId,
          soldQuantity: sql<number>`
            COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
            - COALESCE(SUM(return_sub.returned_quantity), 0)
          `,
        })
        .from(PharmacySalesItemsModel)
        .leftJoin(
          sql`
            (
              SELECT
                ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
                SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
              FROM ${PharmacySalesReturnItemsModel}
              GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
            ) return_sub
          `,
          sql`return_sub.sales_item_id = ${PharmacySalesItemsModel.id}`
        )
        .where(
          inArray(
            PharmacySalesItemsModel.pharmacyStockMedicineId,
            uniqueStockMedicineIds
          )
        )
        .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId);

      const soldByStockMedicineId = new Map(
        soldRows.map((row) => [
          row.stockMedicineId,
          Number(row.soldQuantity) || 0,
        ])
      );

      const priorReturnRows = await tx
        .select({
          stockMedicineId: PharmacyPurchaseReturnItemsModel.stockMedicineId,
          returnedQuantity: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
        })
        .from(PharmacyPurchaseReturnItemsModel)
        .where(
          inArray(
            PharmacyPurchaseReturnItemsModel.stockMedicineId,
            uniqueStockMedicineIds
          )
        )
        .groupBy(PharmacyPurchaseReturnItemsModel.stockMedicineId);

      const alreadyReturnedByStockMedicineId = new Map(
        priorReturnRows.map((row) => [
          row.stockMedicineId,
          Number(row.returnedQuantity) || 0,
        ])
      );

      const stockMedicineById = new Map(
        stockMedicines.map((item) => [item.id, item])
      );

      let totalReturnAmount = 0;

      const returnItems = payload.items.map((item) => {
        const stockMedicine = stockMedicineById.get(item.stockMedicineId);

        if (!stockMedicine) {
          throw new HttpError(400, 'Stock medicine not found');
        }

        const medicineTags =
          tagsByMedicineId.get(stockMedicine.pharmacyMedicineId) || [];
        const hasFullstripTag = medicineTags.some(
          (t) =>
            t && t.trim().toLowerCase().replace(/[\s_]/g, '') === 'fullstrip'
        );
        const packOf = Number(stockMedicine.packOf);

        if (hasFullstripTag && packOf > 1) {
          if (item.returnedQuantity % packOf !== 0) {
            throw new HttpError(
              400,
              `Return quantity for "${stockMedicine.medicineName}" (Batch: ${stockMedicine.batch}) must be in full pack quantities of ${packOf}`
            );
          }
        }

        const purchasedQuantity = Number(stockMedicine.quantity) || 0;
        const soldQuantity =
          soldByStockMedicineId.get(item.stockMedicineId) || 0;
        const alreadyReturned =
          alreadyReturnedByStockMedicineId.get(item.stockMedicineId) || 0;
        const remainingReturnableQuantity =
          purchasedQuantity - soldQuantity - alreadyReturned;

        if (item.returnedQuantity > remainingReturnableQuantity) {
          throw new HttpError(
            400,
            `Return quantity for "${stockMedicine.medicineName}" (Batch: ${stockMedicine.batch}) cannot exceed ${remainingReturnableQuantity}`
          );
        }

        const cost = Number(stockMedicine.cost) || 0;
        const maxRefundAmount = this.roundMoney(cost * item.returnedQuantity);
        const refundAmount = this.roundMoney(
          item.refundAmount === undefined ? maxRefundAmount : item.refundAmount
        );

        if (refundAmount > maxRefundAmount) {
          throw new HttpError(
            400,
            `Refund amount for "${stockMedicine.medicineName}" (Batch: ${stockMedicine.batch}) cannot exceed ${maxRefundAmount}`
          );
        }

        totalReturnAmount += refundAmount;
        affectedMedicineIds.add(stockMedicine.pharmacyMedicineId);

        return {
          stockMedicineId: item.stockMedicineId,
          returnedQuantity: item.returnedQuantity,
          refundAmount: refundAmount.toFixed(2),
        };
      });

      const [purchaseReturn] = await tx
        .insert(PharmacyPurchaseReturnModel)
        .values({
          pharmacyId,
          stockId: payload.stockId,
          totalReturnAmount: this.roundMoney(totalReturnAmount).toFixed(2),
          refundMethod: payload.refundMethod,
          returnReason: payload.returnReason || '-',
          refundNotes: payload.refundNotes || null,
          createdBy: userId,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      const insertedItems = await tx
        .insert(PharmacyPurchaseReturnItemsModel)
        .values(
          returnItems.map((item) => ({
            purchaseReturnId: purchaseReturn.id,
            stockMedicineId: item.stockMedicineId,
            returnedQuantity: item.returnedQuantity,
            refundAmount: item.refundAmount,
          }))
        )
        .returning();

      return {
        ...purchaseReturn,
        items: insertedItems,
      };
    });

    await PharmacyStockService.refreshStockCacheMedicinesSafely(pharmacyId, [
      ...affectedMedicineIds,
    ]);

    return result;
  }

  static async getPurchaseReturns(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      stockId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      refundMethod?: string;
    }
  ) {
    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(PharmacyPurchaseReturnModel.pharmacyId, pharmacyId),
    ];

    if (query.stockId) {
      conditions.push(eq(PharmacyPurchaseReturnModel.stockId, query.stockId));
    }

    if (query.refundMethod) {
      conditions.push(
        eq(PharmacyPurchaseReturnModel.refundMethod, query.refundMethod)
      );
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      conditions.push(
        or(
          sql`CAST(${PharmacyPurchaseReturnModel.id} AS TEXT) ILIKE ${search}`,
          sql`CAST(${PharmacyPurchaseReturnModel.stockId} AS TEXT) ILIKE ${search}`,
          sql`${PharmacyPurchaseReturnModel.returnReason} ILIKE ${search}`
        )!
      );
    }

    if (query.startDate && query.endDate) {
      conditions.push(
        between(
          PharmacyPurchaseReturnModel.createdAt,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      conditions.push(
        sql`${PharmacyPurchaseReturnModel.createdAt} >= ${new Date(query.startDate)}`
      );
    } else if (query.endDate) {
      conditions.push(
        sql`${PharmacyPurchaseReturnModel.createdAt} <= ${new Date(query.endDate)}`
      );
    }

    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(PharmacyPurchaseReturnModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const purchaseReturns = await database
      .select({
        id: PharmacyPurchaseReturnModel.id,
        pharmacyId: PharmacyPurchaseReturnModel.pharmacyId,
        stockId: PharmacyPurchaseReturnModel.stockId,
        totalReturnAmount: PharmacyPurchaseReturnModel.totalReturnAmount,
        refundMethod: PharmacyPurchaseReturnModel.refundMethod,
        returnReason: PharmacyPurchaseReturnModel.returnReason,
        refundNotes: PharmacyPurchaseReturnModel.refundNotes,
        createdBy: PharmacyPurchaseReturnModel.createdBy,
        createdAt: PharmacyPurchaseReturnModel.createdAt,
        updatedAt: PharmacyPurchaseReturnModel.updatedAt,
      })
      .from(PharmacyPurchaseReturnModel)
      .where(and(...conditions))
      .orderBy(desc(PharmacyPurchaseReturnModel.createdAt))
      .limit(limit)
      .offset(offset);

    const returnIds = purchaseReturns.map(
      (purchaseReturn) => purchaseReturn.id
    );
    const items = returnIds.length
      ? await database
          .select({
            id: PharmacyPurchaseReturnItemsModel.id,
            purchaseReturnId: PharmacyPurchaseReturnItemsModel.purchaseReturnId,
            stockMedicineId: PharmacyPurchaseReturnItemsModel.stockMedicineId,
            returnedQuantity: PharmacyPurchaseReturnItemsModel.returnedQuantity,
            refundAmount: PharmacyPurchaseReturnItemsModel.refundAmount,
            medicineName: pharmacyMedicineModel.medicineName,
            batch: PharmacyStockMedicineModel.batch,
          })
          .from(PharmacyPurchaseReturnItemsModel)
          .leftJoin(
            PharmacyStockMedicineModel,
            eq(
              PharmacyPurchaseReturnItemsModel.stockMedicineId,
              PharmacyStockMedicineModel.id
            )
          )
          .leftJoin(
            pharmacyMedicineModel,
            eq(
              PharmacyStockMedicineModel.pharmacyMedicineId,
              pharmacyMedicineModel.id
            )
          )
          .where(
            inArray(
              PharmacyPurchaseReturnItemsModel.purchaseReturnId,
              returnIds
            )
          )
      : [];

    const itemsByReturnId = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByReturnId.get(item.purchaseReturnId) ?? [];
      list.push(item);
      itemsByReturnId.set(item.purchaseReturnId, list);
    }

    return {
      purchaseReturns: purchaseReturns.map((purchaseReturn) => ({
        ...purchaseReturn,
        items: itemsByReturnId.get(purchaseReturn.id) ?? [],
      })),
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }
}
