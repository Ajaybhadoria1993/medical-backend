import { and, between, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { CreateSalesReturnInput } from '../schemas/salesReturn.schema';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { PharmacySalesModel } from '../models/pharmacySales.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import {
  PharmacySalesReturnItemsModel,
  PharmacySalesReturnModel,
} from '../models/pharmacySalesReturn.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import { PharmacyStockService } from './stock.service';

export class PharmacySalesReturnService {
  private static roundMoney(value: number) {
    return Number(value.toFixed(2));
  }

  static async createSalesReturn(
    payload: CreateSalesReturnInput,
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

      const [sale] = await tx
        .select({ id: PharmacySalesModel.id })
        .from(PharmacySalesModel)
        .where(
          and(
            eq(PharmacySalesModel.id, payload.saleId),
            eq(PharmacySalesModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!sale) {
        throw new HttpError(404, 'Sale not found');
      }

      const salesItemIds = payload.items.map((item) => item.salesItemId);
      const uniqueSalesItemIds = [...new Set(salesItemIds)];

      if (salesItemIds.length !== uniqueSalesItemIds.length) {
        throw new HttpError(400, 'Duplicate sales item is not allowed');
      }

      const saleItems = await tx
        .select({
          id: PharmacySalesItemsModel.id,
          pharmacySalesId: PharmacySalesItemsModel.pharmacySalesId,
          stockMedicineId: PharmacySalesItemsModel.pharmacyStockMedicineId,
          soldQuantity: PharmacySalesItemsModel.quantity,
          lineTotal: PharmacySalesItemsModel.total,
          stockMedicineModelId: PharmacyStockMedicineModel.id,
          pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
          medicineName: pharmacyMedicineModel.medicineName,
          packOf: pharmacyMedicineModel.packOf,
          batch: PharmacyStockMedicineModel.batch,
          gstPercentage: HsnTaxMasterModel.gstPercentage,
        })
        .from(PharmacySalesItemsModel)
        .innerJoin(
          PharmacyStockMedicineModel,
          eq(
            PharmacySalesItemsModel.pharmacyStockMedicineId,
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
        .leftJoin(
          HsnTaxMasterModel,
          eq(pharmacyMedicineModel.hsnId, HsnTaxMasterModel.id)
        )
        .where(
          and(
            eq(PharmacySalesItemsModel.pharmacySalesId, payload.saleId),
            inArray(PharmacySalesItemsModel.id, uniqueSalesItemIds)
          )
        )
        .for('update', { of: PharmacySalesItemsModel });

      if (saleItems.length !== uniqueSalesItemIds.length) {
        throw new HttpError(
          400,
          'One or more sales items do not belong to sale'
        );
      }

      const medicineIds = [
        ...new Set(saleItems.map((item) => item.pharmacyMedicineId)),
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

      const priorReturnRows = await tx
        .select({
          salesItemId: PharmacySalesReturnItemsModel.salesItemId,
          returnedQuantity: sql<number>`COALESCE(SUM(${PharmacySalesReturnItemsModel.returnedQuantity}), 0)`,
        })
        .from(PharmacySalesReturnItemsModel)
        .where(
          inArray(PharmacySalesReturnItemsModel.salesItemId, uniqueSalesItemIds)
        )
        .groupBy(PharmacySalesReturnItemsModel.salesItemId);

      const returnedBySalesItemId = new Map(
        priorReturnRows.map((row) => [
          row.salesItemId,
          Number(row.returnedQuantity) || 0,
        ])
      );

      const saleItemById = new Map(saleItems.map((item) => [item.id, item]));
      let gstAmountReturn = 0;
      let totalReturnAmount = 0;

      const returnItems = payload.items.map((item) => {
        const saleItem = saleItemById.get(item.salesItemId);

        if (!saleItem) {
          throw new HttpError(400, 'Sales item not found');
        }

        const medicineTags =
          tagsByMedicineId.get(saleItem.pharmacyMedicineId) || [];
        const hasFullstripTag = medicineTags.some(
          (t) =>
            t && t.trim().toLowerCase().replace(/[\s_]/g, '') === 'fullstrip'
        );
        const packOf = Number(saleItem.packOf);

        if (hasFullstripTag && packOf > 1) {
          if (item.returnedQuantity % packOf !== 0) {
            throw new HttpError(
              400,
              `Return quantity for "${saleItem.medicineName}" (Batch: ${saleItem.batch}) must be in full pack quantities of ${packOf}`
            );
          }
        }

        const soldQuantity = Number(saleItem.soldQuantity) || 0;
        const alreadyReturned =
          returnedBySalesItemId.get(item.salesItemId) || 0;
        const remainingReturnableQuantity = soldQuantity - alreadyReturned;

        if (item.returnedQuantity > remainingReturnableQuantity) {
          throw new HttpError(
            400,
            `Return quantity for "${saleItem.medicineName}" (Batch: ${saleItem.batch}) cannot exceed ${remainingReturnableQuantity}`
          );
        }

        const lineTotal = Number(saleItem.lineTotal) || 0;
        const maxRefundAmount = this.roundMoney(
          (lineTotal / soldQuantity) * item.returnedQuantity
        );
        const refundAmount = this.roundMoney(
          item.refundAmount === undefined ? maxRefundAmount : item.refundAmount
        );

        if (refundAmount > maxRefundAmount) {
          throw new HttpError(
            400,
            `Refund amount for "${saleItem.medicineName}" (Batch: ${saleItem.batch}) cannot exceed ${maxRefundAmount}`
          );
        }

        const gstPercentage = Number(saleItem.gstPercentage) || 0;
        const itemGstAmount = this.roundMoney(
          (refundAmount * gstPercentage) / 100
        );

        gstAmountReturn += itemGstAmount;
        totalReturnAmount += refundAmount + itemGstAmount;
        affectedMedicineIds.add(saleItem.pharmacyMedicineId);

        return {
          salesItemId: item.salesItemId,
          stockMedicineId: saleItem.stockMedicineId,
          returnedQuantity: item.returnedQuantity,
          refundAmount: refundAmount.toFixed(2),
        };
      });

      const [salesReturn] = await tx
        .insert(PharmacySalesReturnModel)
        .values({
          pharmacyId,
          saleId: payload.saleId,
          gstAmountReturn: this.roundMoney(gstAmountReturn).toFixed(2),
          totalReturnAmount: this.roundMoney(totalReturnAmount).toFixed(2),
          refundMethod: payload.refundMethod,
          returnReason: payload.returnReason || null,
          refundNotes: payload.refundNotes || null,
          createdBy: userId,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      const insertedItems = await tx
        .insert(PharmacySalesReturnItemsModel)
        .values(
          returnItems.map((item) => ({
            salesReturnId: salesReturn.id,
            salesItemId: item.salesItemId,
            stockMedicineId: item.stockMedicineId,
            returnedQuantity: item.returnedQuantity,
            refundAmount: item.refundAmount,
          }))
        )
        .returning();

      return {
        ...salesReturn,
        items: insertedItems,
      };
    });

    await PharmacyStockService.refreshStockCacheMedicinesSafely(pharmacyId, [
      ...affectedMedicineIds,
    ]);

    return result;
  }

  static async getSalesReturns(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      saleId?: string;
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
      eq(PharmacySalesReturnModel.pharmacyId, pharmacyId),
    ];

    if (query.saleId) {
      conditions.push(eq(PharmacySalesReturnModel.saleId, query.saleId));
    }

    if (query.refundMethod) {
      conditions.push(
        eq(PharmacySalesReturnModel.refundMethod, query.refundMethod)
      );
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      conditions.push(
        or(
          sql`CAST(${PharmacySalesReturnModel.id} AS TEXT) ILIKE ${search}`,
          sql`CAST(${PharmacySalesReturnModel.saleId} AS TEXT) ILIKE ${search}`,
          sql`${PharmacySalesReturnModel.returnReason} ILIKE ${search}`
        )!
      );
    }

    if (query.startDate && query.endDate) {
      conditions.push(
        between(
          PharmacySalesReturnModel.createdAt,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      conditions.push(
        sql`${PharmacySalesReturnModel.createdAt} >= ${new Date(query.startDate)}`
      );
    } else if (query.endDate) {
      conditions.push(
        sql`${PharmacySalesReturnModel.createdAt} <= ${new Date(query.endDate)}`
      );
    }

    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(PharmacySalesReturnModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const salesReturns = await database
      .select({
        id: PharmacySalesReturnModel.id,
        pharmacyId: PharmacySalesReturnModel.pharmacyId,
        saleId: PharmacySalesReturnModel.saleId,
        gstAmountReturn: PharmacySalesReturnModel.gstAmountReturn,
        totalReturnAmount: PharmacySalesReturnModel.totalReturnAmount,
        refundMethod: PharmacySalesReturnModel.refundMethod,
        returnReason: PharmacySalesReturnModel.returnReason,
        refundNotes: PharmacySalesReturnModel.refundNotes,
        createdBy: PharmacySalesReturnModel.createdBy,
        createdAt: PharmacySalesReturnModel.createdAt,
        updatedAt: PharmacySalesReturnModel.updatedAt,
      })
      .from(PharmacySalesReturnModel)
      .where(and(...conditions))
      .orderBy(desc(PharmacySalesReturnModel.createdAt))
      .limit(limit)
      .offset(offset);

    const returnIds = salesReturns.map((salesReturn) => salesReturn.id);
    const items = returnIds.length
      ? await database
          .select({
            id: PharmacySalesReturnItemsModel.id,
            salesReturnId: PharmacySalesReturnItemsModel.salesReturnId,
            salesItemId: PharmacySalesReturnItemsModel.salesItemId,
            stockMedicineId: PharmacySalesReturnItemsModel.stockMedicineId,
            returnedQuantity: PharmacySalesReturnItemsModel.returnedQuantity,
            refundAmount: PharmacySalesReturnItemsModel.refundAmount,
            medicineName: pharmacyMedicineModel.medicineName,
            batch: PharmacyStockMedicineModel.batch,
          })
          .from(PharmacySalesReturnItemsModel)
          .leftJoin(
            PharmacyStockMedicineModel,
            eq(
              PharmacySalesReturnItemsModel.stockMedicineId,
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
            inArray(PharmacySalesReturnItemsModel.salesReturnId, returnIds)
          )
      : [];

    const itemsByReturnId = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByReturnId.get(item.salesReturnId) ?? [];
      list.push(item);
      itemsByReturnId.set(item.salesReturnId, list);
    }

    return {
      salesReturns: salesReturns.map((salesReturn) => ({
        ...salesReturn,
        items: itemsByReturnId.get(salesReturn.id) ?? [],
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
