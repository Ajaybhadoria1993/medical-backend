import {
  and,
  eq,
  sql,
  desc,
  between,
  ne,
  ilike,
  or,
  gte,
  lte,
  asc,
  inArray,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import ExcelJS from 'exceljs';
import {
  AddStockInput,
  UpdateStockInput,
  UpdateStockMedicineInput,
} from '../schemas/stock.schema';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { PharmacySupplierModel } from '../models/pharmacySupplier.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import { PharmacySalesReturnItemsModel } from '../models/pharmacySalesReturn.model';
import {
  PharmacyPurchaseReturnItemsModel,
  PharmacyPurchaseReturnModel,
} from '../models/pharmacyPurchaseReturn.model';
import { deleteFromS3 } from '../../../configurations/s3';
import logger from '../../../utils/logger';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import redisClient from '../../../configurations/redisConfig';

type PharmacyStockCacheItem = {
  medicineName: string;
  availableQuantity: number;
};

export class PharmacyStockService {
  private static getStockCacheKey(pharmacyId: string) {
    return `pharmacy:stock-cache:${pharmacyId}`;
  }

  private static async buildStockCache(pharmacyId: string) {
    const rows = await database
      .select({
        medicineName: pharmacyMedicineModel.medicineName,
        availableQuantity: sql<number>`
          COALESCE(
            SUM(
              GREATEST(
                COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
                - COALESCE(sales.sold_quantity, 0)
                + COALESCE(return_sub.returned_quantity, 0)
                - COALESCE(purchase_return_sub.returned_quantity, 0),
                0
              )
            ),
            0
          )
        `,
      })
      .from(pharmacyMedicineModel)
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          pharmacyMedicineModel.id,
          PharmacyStockMedicineModel.pharmacyMedicineId
        )
      )
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesItemsModel.pharmacyStockMedicineId} AS stock_medicine_id,
              SUM(${PharmacySalesItemsModel.quantity}) AS sold_quantity
            FROM ${PharmacySalesItemsModel}
            GROUP BY ${PharmacySalesItemsModel.pharmacyStockMedicineId}
          ) sales
        `,
        sql`sales.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesReturnItemsModel.stockMedicineId} AS stock_medicine_id,
              SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
            FROM ${PharmacySalesReturnItemsModel}
            GROUP BY ${PharmacySalesReturnItemsModel.stockMedicineId}
          ) return_sub
        `,
        sql`return_sub.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacyPurchaseReturnItemsModel.stockMedicineId} AS stock_medicine_id,
              SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}) AS returned_quantity
            FROM ${PharmacyPurchaseReturnItemsModel}
            GROUP BY ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
          ) purchase_return_sub
        `,
        sql`purchase_return_sub.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .where(
        and(
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active'),
          sql`${PharmacyStockMedicineModel.expiry} > NOW()`
        )
      )
      .groupBy(pharmacyMedicineModel.id, pharmacyMedicineModel.medicineName)
      .having(
        sql`
        COALESCE(
          SUM(
            GREATEST(
              COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
              - COALESCE(sales.sold_quantity, 0)
              + COALESCE(return_sub.returned_quantity, 0)
              - COALESCE(purchase_return_sub.returned_quantity, 0),
              0
            )
          ),
          0
        ) > 0
      `
      )
      .orderBy(asc(pharmacyMedicineModel.medicineName));

    return rows.map((row: PharmacyStockCacheItem) => ({
      medicineName: row.medicineName,
      availableQuantity: Number(row.availableQuantity) || 0,
    }));
  }

  private static async buildStockCacheForMedicines(
    pharmacyId: string,
    medicineIds: string[]
  ) {
    const uniqueMedicineIds = [...new Set(medicineIds)].filter(Boolean);

    if (uniqueMedicineIds.length === 0) {
      return [];
    }

    const rows = await database
      .select({
        medicineName: pharmacyMedicineModel.medicineName,
        availableQuantity: sql<number>`
          COALESCE(
            SUM(
              GREATEST(
                COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
                - COALESCE(sales.sold_quantity, 0)
                + COALESCE(return_sub.returned_quantity, 0)
                - COALESCE(purchase_return_sub.returned_quantity, 0),
                0
              )
            ),
            0
          )
        `,
      })
      .from(pharmacyMedicineModel)
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          pharmacyMedicineModel.id,
          PharmacyStockMedicineModel.pharmacyMedicineId
        )
      )
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesItemsModel.pharmacyStockMedicineId} AS stock_medicine_id,
              SUM(${PharmacySalesItemsModel.quantity}) AS sold_quantity
            FROM ${PharmacySalesItemsModel}
            GROUP BY ${PharmacySalesItemsModel.pharmacyStockMedicineId}
          ) sales
        `,
        sql`sales.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacySalesReturnItemsModel.stockMedicineId} AS stock_medicine_id,
              SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
            FROM ${PharmacySalesReturnItemsModel}
            GROUP BY ${PharmacySalesReturnItemsModel.stockMedicineId}
          ) return_sub
        `,
        sql`return_sub.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .leftJoin(
        sql`
          (
            SELECT
              ${PharmacyPurchaseReturnItemsModel.stockMedicineId} AS stock_medicine_id,
              SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}) AS returned_quantity
            FROM ${PharmacyPurchaseReturnItemsModel}
            GROUP BY ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
          ) purchase_return_sub
        `,
        sql`purchase_return_sub.stock_medicine_id = ${PharmacyStockMedicineModel.id}`
      )
      .where(
        and(
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
          eq(pharmacyMedicineModel.status, 'active'),
          inArray(pharmacyMedicineModel.id, uniqueMedicineIds),
          sql`${PharmacyStockMedicineModel.expiry} > NOW()`
        )
      )
      .groupBy(pharmacyMedicineModel.id, pharmacyMedicineModel.medicineName)
      .having(
        sql`
        COALESCE(
          SUM(
            GREATEST(
              COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
              - COALESCE(sales.sold_quantity, 0)
              + COALESCE(return_sub.returned_quantity, 0)
              - COALESCE(purchase_return_sub.returned_quantity, 0),
              0
            )
          ),
          0
        ) > 0
      `
      );

    return rows.map((row: PharmacyStockCacheItem) => ({
      medicineName: row.medicineName,
      availableQuantity: Number(row.availableQuantity) || 0,
    }));
  }

  static async refreshStockCache(pharmacyId: string) {
    const cache = await this.buildStockCache(pharmacyId);
    await redisClient.set(
      this.getStockCacheKey(pharmacyId),
      JSON.stringify(cache)
    );
    return cache;
  }

  static async refreshStockCacheSafely(pharmacyId: string) {
    try {
      await this.refreshStockCache(pharmacyId);
    } catch (error) {
      logger.warn('[Cache] Failed to refresh pharmacy stock cache', {
        pharmacyId,
        error,
      });
    }
  }

  static async refreshStockCacheMedicines(
    pharmacyId: string,
    medicineIds: string[]
  ) {
    const uniqueMedicineIds = [...new Set(medicineIds)].filter(Boolean);

    if (uniqueMedicineIds.length === 0) {
      return [];
    }

    const [cached, affectedMedicines, updatedItems] = await Promise.all([
      redisClient.get(this.getStockCacheKey(pharmacyId)),
      database
        .select({
          medicineName: pharmacyMedicineModel.medicineName,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            inArray(pharmacyMedicineModel.id, uniqueMedicineIds)
          )
        ),
      this.buildStockCacheForMedicines(pharmacyId, uniqueMedicineIds),
    ]);

    if (!cached) {
      return updatedItems;
    }

    const currentCache = JSON.parse(cached) as PharmacyStockCacheItem[];
    const affectedMedicineNames = new Set(
      affectedMedicines.map((medicine) => medicine.medicineName)
    );

    const nextCache = currentCache.filter(
      (item) => !affectedMedicineNames.has(item.medicineName)
    );

    nextCache.push(...updatedItems);
    nextCache.sort((a, b) => a.medicineName.localeCompare(b.medicineName));

    await redisClient.set(
      this.getStockCacheKey(pharmacyId),
      JSON.stringify(nextCache)
    );

    return updatedItems;
  }

  static async refreshStockCacheMedicinesSafely(
    pharmacyId: string,
    medicineIds: string[]
  ) {
    try {
      await this.refreshStockCacheMedicines(pharmacyId, medicineIds);
    } catch (error) {
      logger.warn('[Cache] Failed to refresh pharmacy stock cache medicines', {
        pharmacyId,
        medicineIds,
        error,
      });
    }
  }

  static async getStockCache(pharmacyId: string) {
    const [pharmacy] = await database
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

    const cacheKey = this.getStockCacheKey(pharmacyId);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as PharmacyStockCacheItem[];
      }
    } catch (error) {
      logger.warn('[Cache] Failed to read pharmacy stock cache', {
        pharmacyId,
        error,
      });
    }

    return await this.refreshStockCache(pharmacyId);
  }

  static async addStock(payload: AddStockInput, pharmacyId: string) {
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

      if (payload.supplierId) {
        const [supplier] = await tx
          .select({ id: PharmacySupplierModel.id })
          .from(PharmacySupplierModel)
          .where(
            and(
              eq(PharmacySupplierModel.id, payload.supplierId),
              eq(PharmacySupplierModel.pharmacyId, pharmacyId)
            )
          )
          .limit(1);

        if (!supplier) {
          throw new HttpError(404, 'Supplier not found');
        }
      }

      const unit = payload.medicines.length;
      let totalAmount = 0;

      const medicinesWithTotalCost = payload.medicines.map((medicine) => {
        const totalCost = medicine.cost * medicine.quantity;
        totalAmount += totalCost;
        return {
          ...medicine,
          totalCost,
        };
      });

      // FIX: Add unit and totalAmount values here
      const [stock] = await tx
        .insert(PharmacyStockModel)
        .values({
          pharmacyId: pharmacyId,
          pharmacySupplierId: payload.supplierId || null,
          purchaseDate: new Date(payload.purchaseDate),
          invoice: payload.invoice?.trim() || null,
          pharmacyStockPaymentStatus: payload.pharmacyStockPaymentStatus,
          paymentNotes: payload.paymentNotes?.trim() || null,
          unit: unit,
          totalAmount: totalAmount.toFixed(2),
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      const medicineIds = medicinesWithTotalCost.map(
        (m) => m.pharmacyMedicineId
      );

      // Batch select existing medicines for the pharmacy
      const existingMedicines = await tx
        .select({
          id: pharmacyMedicineModel.id,
          medicineName: pharmacyMedicineModel.medicineName,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            inArray(pharmacyMedicineModel.id, medicineIds),
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId)
          )
        );

      const medicineMap = new Map(existingMedicines.map((m) => [m.id, m]));

      // Verify all medicines exist
      for (const medicineId of medicineIds) {
        if (!medicineMap.has(medicineId)) {
          throw new HttpError(404, `Medicine with ID ${medicineId} not found`);
        }
      }

      // Check duplicates and prepare batch values
      const incomingBatchSet = new Set<string>();
      const insertValues = [];
      for (const medicine of medicinesWithTotalCost) {
        const existingMedicine = medicineMap.get(medicine.pharmacyMedicineId)!;
        if (medicine.batch?.trim()) {
          const key = `${medicine.pharmacyMedicineId}:${medicine.batch.trim()}`;
          if (incomingBatchSet.has(key)) {
            throw new HttpError(
              400,
              `Batch ${medicine.batch} is duplicated for ${existingMedicine.medicineName} in this invoice`
            );
          }
          incomingBatchSet.add(key);
        }

        insertValues.push({
          pharmacyStockId: stock.id,
          pharmacyMedicineId: medicine.pharmacyMedicineId,
          batch: medicine.batch?.trim() || null,
          expiry: new Date(medicine.expiry),
          quantity: medicine.quantity,
          mrp: medicine.mrp.toFixed(2),
          cost: medicine.cost.toFixed(2),
          totalCost: medicine.totalCost.toFixed(2),
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        });
      }

      // Batch insert all stock medicines
      const stockMedicines = await tx
        .insert(PharmacyStockMedicineModel)
        .values(insertValues)
        .returning();

      return {
        stock,
        medicines: stockMedicines,
        summary: {
          unitCount: unit,
          totalAmount: totalAmount,
        },
      };
    });

    await this.refreshStockCacheMedicinesSafely(
      pharmacyId,
      payload.medicines.map((medicine) => medicine.pharmacyMedicineId)
    );

    return result;
  }

  static async getStocks(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
      supplierId?: string;
      pharmacyStockPaymentStatus?: 'paid' | 'unpaid' | 'partial';
      startDate?: string;
      endDate?: string;
      medicineName?: string;
      batch?: string;
    }
  ) {
    const [pharmacy] = await database
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

    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    // const { limit, offset } = pagination(pageNumber, pageSize);

    // Build conditions for stock
    const stockConditions: any[] = [
      eq(PharmacyStockModel.pharmacyId, pharmacyId),
    ];

    if (query.supplierId) {
      stockConditions.push(
        eq(PharmacyStockModel.pharmacySupplierId, query.supplierId)
      );
    }

    if (query.pharmacyStockPaymentStatus) {
      stockConditions.push(
        eq(
          PharmacyStockModel.pharmacyStockPaymentStatus,
          query.pharmacyStockPaymentStatus
        )
      );
    }

    if (query.startDate && query.endDate) {
      stockConditions.push(
        between(
          PharmacyStockModel.purchaseDate,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      stockConditions.push(
        sql`${PharmacyStockModel.purchaseDate} >= ${new Date(query.startDate)}`
      );
    } else if (query.endDate) {
      stockConditions.push(
        sql`${PharmacyStockModel.purchaseDate} <= ${new Date(query.endDate)}`
      );
    }

    // Get paginated stocks
    const stocks = await database
      .selectDistinct({
        id: PharmacyStockModel.id,
        pharmacyId: PharmacyStockModel.pharmacyId,
        pharmacySupplierId: PharmacyStockModel.pharmacySupplierId,
        purchaseDate: PharmacyStockModel.purchaseDate,
        invoice: PharmacyStockModel.invoice,
        pharmacyStockPaymentStatus:
          PharmacyStockModel.pharmacyStockPaymentStatus,
        paymentNotes: PharmacyStockModel.paymentNotes,
        unit: PharmacyStockModel.unit,
        totalAmount: PharmacyStockModel.totalAmount,
        createdAt: PharmacyStockModel.createdAt,
        updatedAt: PharmacyStockModel.updatedAt,
        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,
      })
      .from(PharmacyStockModel)
      .leftJoin(
        PharmacySupplierModel,
        eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id)
      )
      .leftJoin(
        PharmacyStockMedicineModel,
        eq(PharmacyStockModel.id, PharmacyStockMedicineModel.pharmacyStockId)
      )
      .leftJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(and(...stockConditions))
      .orderBy(desc(PharmacyStockModel.purchaseDate));

    // Get medicines for all stocks in a single batched query
    const stockIds = stocks.map((stock) => stock.id);

    const allStockMedicines = stockIds.length
      ? await database
          .select({
            id: PharmacyStockMedicineModel.id,
            pharmacyStockId: PharmacyStockMedicineModel.pharmacyStockId,
            pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
            batch: PharmacyStockMedicineModel.batch,
            expiry: PharmacyStockMedicineModel.expiry,
            quantity: PharmacyStockMedicineModel.quantity,
            mrp: PharmacyStockMedicineModel.mrp,
            cost: PharmacyStockMedicineModel.cost,
            totalCost: PharmacyStockMedicineModel.totalCost,
            medicineName: pharmacyMedicineModel.medicineName,
            sku: pharmacyMedicineModel.sku,
            category: pharmacyMedicineModel.category,
            form: pharmacyMedicineModel.form,
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
          .where(inArray(PharmacyStockMedicineModel.pharmacyStockId, stockIds))
      : [];

    const medicinesByStockId = new Map<string, typeof allStockMedicines>();
    for (const medicine of allStockMedicines) {
      const list = medicinesByStockId.get(medicine.pharmacyStockId) ?? [];
      list.push(medicine);
      medicinesByStockId.set(medicine.pharmacyStockId, list);
    }

    const stocksWithMedicines = stocks.map((stock) => ({
      ...stock,
      medicines: medicinesByStockId.get(stock.id) ?? [],
    }));

    // Apply additional filters on medicines
    let filteredStocks = stocksWithMedicines;

    if (query.medicineName || query.batch) {
      filteredStocks = stocksWithMedicines.filter((stock) => {
        return stock.medicines.some((medicine) => {
          let matches = true;
          if (query.medicineName) {
            const medicineName = medicine.medicineName?.toLowerCase() || '';
            matches =
              matches &&
              medicineName.includes(query.medicineName!.toLowerCase());
          }
          if (query.batch) {
            const batch = medicine.batch?.toLowerCase() || '';
            matches = matches && batch.includes(query.batch!.toLowerCase());
          }
          return matches;
        });
      });
    }

    if (query.search) {
      const search = query.search.toLowerCase();

      filteredStocks = filteredStocks.filter((stock) => {
        if (stock.id.toLowerCase().includes(search)) {
          return true;
        }

        return stock.medicines.some((medicine) => {
          const medicineName = medicine.medicineName?.toLowerCase() || '';

          const batch = medicine.batch?.toLowerCase() || '';

          const sku = medicine.sku?.toLowerCase() || '';

          return (
            medicineName.includes(search) ||
            batch.includes(search) ||
            sku.includes(search)
          );
        });
      });
    }

    // Apply pagination again after filtering
    const start = (pageNumber - 1) * pageSize;
    const end = start + pageSize;
    const paginatedStocks = filteredStocks.slice(start, end);
    const filteredTotalCount = filteredStocks.length;
    const filteredTotalPages = Math.ceil(filteredTotalCount / pageSize);

    return {
      stocks: paginatedStocks,
      pagination: {
        totalRecords: filteredTotalCount,
        totalPages: filteredTotalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getStockById(id: string, pharmacyId: string) {
    const [stock] = await database
      .select({
        id: PharmacyStockModel.id,
        pharmacyId: PharmacyStockModel.pharmacyId,
        pharmacySupplierId: PharmacyStockModel.pharmacySupplierId,
        purchaseDate: PharmacyStockModel.purchaseDate,
        invoice: PharmacyStockModel.invoice,
        pharmacyStockPaymentStatus:
          PharmacyStockModel.pharmacyStockPaymentStatus,
        paymentNotes: PharmacyStockModel.paymentNotes,
        unit: PharmacyStockModel.unit,
        totalAmount: PharmacyStockModel.totalAmount,
        createdAt: PharmacyStockModel.createdAt,
        updatedAt: PharmacyStockModel.updatedAt,
        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,
      })
      .from(PharmacyStockModel)
      .leftJoin(
        PharmacySupplierModel,
        eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id)
      )
      .where(
        and(
          eq(PharmacyStockModel.id, id),
          eq(PharmacyStockModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!stock) {
      throw new HttpError(404, 'Stock entry not found');
    }

    // Get medicines for this stock
    const medicines = await database
      .select({
        id: PharmacyStockMedicineModel.id,
        pharmacyStockId: PharmacyStockMedicineModel.pharmacyStockId,
        pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
        batch: PharmacyStockMedicineModel.batch,
        expiry: PharmacyStockMedicineModel.expiry,
        quantity: PharmacyStockMedicineModel.quantity,
        mrp: PharmacyStockMedicineModel.mrp,
        cost: PharmacyStockMedicineModel.cost,
        totalCost: PharmacyStockMedicineModel.totalCost,
        medicineName: pharmacyMedicineModel.medicineName,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,
        soldQuantity: sql<number>`
          COALESCE((
            SELECT
              COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
              - COALESCE(SUM(return_sub.returned_quantity), 0)
            FROM ${PharmacySalesItemsModel}
            LEFT JOIN (
              SELECT
                ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
                SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
              FROM ${PharmacySalesReturnItemsModel}
              GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
            ) return_sub
              ON return_sub.sales_item_id = ${PharmacySalesItemsModel.id}
            WHERE ${PharmacySalesItemsModel.pharmacyStockMedicineId}
              = ${PharmacyStockMedicineModel.id}
          ), 0)
        `,
        purchaseReturnedQuantity: sql<number>`
          COALESCE((
            SELECT SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity})
            FROM ${PharmacyPurchaseReturnItemsModel}
            WHERE ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
              = ${PharmacyStockMedicineModel.id}
          ), 0)
        `,
      })
      .from(PharmacyStockMedicineModel)
      .leftJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(eq(PharmacyStockMedicineModel.pharmacyStockId, id));

    return {
      ...stock,
      medicines,
    };
  }

  static async updateStock(
    id: string,
    payload: UpdateStockInput,
    pharmacyId: string
  ) {
    const affectedMedicineIds = new Set<string>();

    const result = await database.transaction(async (tx) => {
      // Verify stock exists
      const [existingStock] = await tx
        .select({
          id: PharmacyStockModel.id,
          pharmacySupplierId: PharmacyStockModel.pharmacySupplierId,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.id, id),
            eq(PharmacyStockModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingStock) {
        throw new HttpError(404, 'Stock entry not found');
      }

      // const effectiveSupplierId =
      //   payload.supplierId !== undefined
      //     ? payload.supplierId
      //     : existingStock.pharmacySupplierId;

      // Verify supplier if updating
      if (payload.supplierId) {
        const [supplier] = await tx
          .select({ id: PharmacySupplierModel.id })
          .from(PharmacySupplierModel)
          .where(
            and(
              eq(PharmacySupplierModel.id, payload.supplierId),
              eq(PharmacySupplierModel.pharmacyId, pharmacyId)
            )
          )
          .limit(1);

        if (!supplier) {
          throw new HttpError(404, 'Supplier not found');
        }
      }

      // Update stock header
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (payload.supplierId !== undefined)
        updateData.pharmacySupplierId = payload.supplierId;
      if (payload.purchaseDate !== undefined)
        updateData.purchaseDate = new Date(payload.purchaseDate);
      if (payload.invoice !== undefined) updateData.invoice = payload.invoice;
      if (payload.pharmacyStockPaymentStatus !== undefined)
        updateData.pharmacyStockPaymentStatus =
          payload.pharmacyStockPaymentStatus;
      if (payload.paymentNotes !== undefined)
        updateData.paymentNotes = payload.paymentNotes;

      await tx
        .update(PharmacyStockModel)
        .set(updateData)
        .where(eq(PharmacyStockModel.id, id))
        .returning();

      // Handle medicines update if provided
      if (payload.medicines && Array.isArray(payload.medicines)) {
        // Get existing medicines for this stock
        const existingMedicines = await tx
          .select({
            id: PharmacyStockMedicineModel.id,
            pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
            batch: PharmacyStockMedicineModel.batch,
            quantity: PharmacyStockMedicineModel.quantity,
          })
          .from(PharmacyStockMedicineModel)
          .where(eq(PharmacyStockMedicineModel.pharmacyStockId, id));

        existingMedicines.forEach((medicine) => {
          affectedMedicineIds.add(medicine.pharmacyMedicineId);
        });

        const incomingMedicineIds = new Set(
          payload.medicines.filter((m) => m.id).map((m) => m.id)
        );

        const medicineIds = payload.medicines.map((m) => m.pharmacyMedicineId);

        // Batch select existing medicines for the pharmacy
        const existingMedicinesList = await tx
          .select({
            id: pharmacyMedicineModel.id,
            medicineName: pharmacyMedicineModel.medicineName,
          })
          .from(pharmacyMedicineModel)
          .where(
            and(
              inArray(pharmacyMedicineModel.id, medicineIds),
              eq(pharmacyMedicineModel.pharmacyId, pharmacyId)
            )
          );

        const medicineMap = new Map(
          existingMedicinesList.map((m) => [m.id, m])
        );

        // Verify all medicines exist
        for (const medicine of payload.medicines) {
          if (!medicineMap.has(medicine.pharmacyMedicineId)) {
            throw new HttpError(
              404,
              `Medicine with ID ${medicine.pharmacyMedicineId} not found`
            );
          }
          affectedMedicineIds.add(medicine.pharmacyMedicineId);
        }

        // Build map of existing batches for this stock invoice to check duplicates
        const batchMap = new Map<string, string[]>();
        for (const b of existingMedicines) {
          if (b.batch?.trim()) {
            const key = `${b.pharmacyMedicineId}:${b.batch.trim()}`;
            const ids = batchMap.get(key) ?? [];
            ids.push(b.id);
            batchMap.set(key, ids);
          }
        }

        // Check duplicates within the invoice
        const incomingBatchSet = new Set<string>();
        for (const medicine of payload.medicines) {
          const existingMedicineMaster = medicineMap.get(
            medicine.pharmacyMedicineId
          )!;
          if (medicine.batch?.trim()) {
            const key = `${medicine.pharmacyMedicineId}:${medicine.batch.trim()}`;
            const matchIds = batchMap.get(key) || [];
            const duplicates = medicine.id
              ? matchIds.filter((dbId) => dbId !== medicine.id)
              : matchIds;

            if (duplicates.length > 0 || incomingBatchSet.has(key)) {
              throw new HttpError(
                400,
                `Batch ${medicine.batch} already exists for medicine ${existingMedicineMaster.medicineName} in this invoice`
              );
            }
            incomingBatchSet.add(key);
          }
        }

        // Check if updating quantity below already sold quantity for existing medicines
        const existingMedicineIdsToUpdate = payload.medicines
          .filter((m) => m.id)
          .map((m) => m.id as string);

        if (existingMedicineIdsToUpdate.length > 0) {
          const soldItemsForUpdate = await tx
            .select({
              pharmacyStockMedicineId:
                PharmacySalesItemsModel.pharmacyStockMedicineId,
              totalSold: sql<number>`
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
                existingMedicineIdsToUpdate
              )
            )
            .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId);

          const soldMapForUpdate = new Map<string, number>(
            soldItemsForUpdate.map((item) => [
              item.pharmacyStockMedicineId,
              Number(item.totalSold),
            ])
          );

          const purchaseReturnedForUpdate = await tx
            .select({
              stockMedicineId: PharmacyPurchaseReturnItemsModel.stockMedicineId,
              totalReturned: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
            })
            .from(PharmacyPurchaseReturnItemsModel)
            .where(
              inArray(
                PharmacyPurchaseReturnItemsModel.stockMedicineId,
                existingMedicineIdsToUpdate
              )
            )
            .groupBy(PharmacyPurchaseReturnItemsModel.stockMedicineId);

          const purchaseReturnedMapForUpdate = new Map<string, number>(
            purchaseReturnedForUpdate.map((item) => [
              item.stockMedicineId,
              Number(item.totalReturned),
            ])
          );

          for (const medicine of payload.medicines) {
            if (medicine.id) {
              const soldQty = soldMapForUpdate.get(medicine.id) ?? 0;
              const purchaseReturnedQty =
                purchaseReturnedMapForUpdate.get(medicine.id) ?? 0;
              const accountedQty = soldQty + purchaseReturnedQty;
              if (medicine.quantity < accountedQty) {
                const existingMedicineMaster = medicineMap.get(
                  medicine.pharmacyMedicineId
                );
                const medName =
                  existingMedicineMaster?.medicineName || 'Medicine';
                const batchInfo = medicine.batch?.trim()
                  ? `batch '${medicine.batch.trim()}'`
                  : `medicine '${medName}'`;
                throw new HttpError(
                  400,
                  `Cannot reduce quantity of ${batchInfo} to ${medicine.quantity} as ${accountedQty} units have already been sold or returned to supplier`
                );
              }
            }
          }
        }

        // 1. Update or Create medicines
        const newMedicinesValues = [];
        for (const medicine of payload.medicines) {
          const totalCost = medicine.cost * medicine.quantity;

          if (medicine.id) {
            // Update existing medicine
            await tx
              .update(PharmacyStockMedicineModel)
              .set({
                pharmacyMedicineId: medicine.pharmacyMedicineId,
                batch: medicine.batch?.trim() || null,
                expiry: new Date(medicine.expiry),
                quantity: medicine.quantity,
                mrp: medicine.mrp.toString(),
                cost: medicine.cost.toString(),
                totalCost: totalCost.toString(),
                updatedAt: new Date(),
              })
              .where(eq(PharmacyStockMedicineModel.id, medicine.id));
          } else {
            // Collect for batch insert
            newMedicinesValues.push({
              pharmacyStockId: id,
              pharmacyMedicineId: medicine.pharmacyMedicineId,
              batch: medicine.batch?.trim() || null,
              expiry: new Date(medicine.expiry),
              quantity: medicine.quantity,
              mrp: medicine.mrp.toString(),
              cost: medicine.cost.toString(),
              totalCost: totalCost.toString(),
              createdAt: sql`NOW()`,
              updatedAt: sql`NOW()`,
            });
          }
        }

        if (newMedicinesValues.length > 0) {
          await tx
            .insert(PharmacyStockMedicineModel)
            .values(newMedicinesValues);
        }

        // 2. Delete medicines that are not in incoming list
        const medicinesToDelete = existingMedicines.filter(
          (m) => !incomingMedicineIds.has(m.id)
        );

        if (medicinesToDelete.length > 0) {
          const deleteIds = medicinesToDelete.map((m) => m.id);

          // Batch check if any of these medicines have been sold
          const soldItems = await tx
            .select({
              pharmacyStockMedicineId:
                PharmacySalesItemsModel.pharmacyStockMedicineId,
            })
            .from(PharmacySalesItemsModel)
            .where(
              inArray(
                PharmacySalesItemsModel.pharmacyStockMedicineId,
                deleteIds
              )
            );

          const soldSet = new Set(
            soldItems.map((item) => item.pharmacyStockMedicineId)
          );

          for (const m of medicinesToDelete) {
            if (soldSet.has(m.id)) {
              throw new HttpError(
                400,
                `Cannot delete medicine with batch ${m.batch} as it has been sold in sales transactions`
              );
            }
          }

          // Batch delete the medicines
          await tx
            .delete(PharmacyStockMedicineModel)
            .where(inArray(PharmacyStockMedicineModel.id, deleteIds));
        }
      }

      // Recalculate stock totals after all changes
      await this.recalculateStockTotals(id, tx);

      // Get updated stock with medicines
      const updatedStockWithMedicines = await this.getStockById(id, pharmacyId);

      return updatedStockWithMedicines;
    });

    await this.refreshStockCacheMedicinesSafely(pharmacyId, [
      ...affectedMedicineIds,
    ]);

    return result;
  }

  static async updateStockMedicine(
    stockMedicineId: string,
    payload: UpdateStockMedicineInput,
    pharmacyId: string
  ) {
    const result = await database.transaction(async (tx) => {
      // Verify stock medicine exists and belongs to pharmacy
      const [existingStockMedicine] = await tx
        .select({
          id: PharmacyStockMedicineModel.id,
          pharmacyStockId: PharmacyStockMedicineModel.pharmacyStockId,
          pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
          batch: PharmacyStockMedicineModel.batch,
          quantity: PharmacyStockMedicineModel.quantity,
          cost: PharmacyStockMedicineModel.cost,
          totalCost: PharmacyStockMedicineModel.totalCost,
        })
        .from(PharmacyStockMedicineModel)
        .leftJoin(
          PharmacyStockModel,
          eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
        )
        .where(
          and(
            eq(PharmacyStockMedicineModel.id, stockMedicineId),
            eq(PharmacyStockModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingStockMedicine) {
        throw new HttpError(404, 'Stock medicine not found');
      }

      // Check for duplicate batch if updating batch
      if (payload.batch && payload.batch !== existingStockMedicine.batch) {
        const [duplicateBatch] = await tx
          .select({ id: PharmacyStockMedicineModel.id })
          .from(PharmacyStockMedicineModel)
          .where(
            and(
              eq(
                PharmacyStockMedicineModel.pharmacyMedicineId,
                existingStockMedicine.pharmacyMedicineId
              ),
              eq(PharmacyStockMedicineModel.batch, payload.batch),
              ne(PharmacyStockMedicineModel.id, stockMedicineId)
            )
          )
          .limit(1);

        if (duplicateBatch) {
          throw new HttpError(
            400,
            `Batch ${payload.batch} already exists for this medicine`
          );
        }
      }

      // Check if updating quantity below already sold quantity
      if (payload.quantity !== undefined) {
        const [soldResult] = await tx
          .select({
            totalSold: sql<number>`
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
            eq(PharmacySalesItemsModel.pharmacyStockMedicineId, stockMedicineId)
          );

        const [purchaseReturnedResult] = await tx
          .select({
            totalReturned: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
          })
          .from(PharmacyPurchaseReturnItemsModel)
          .where(
            eq(
              PharmacyPurchaseReturnItemsModel.stockMedicineId,
              stockMedicineId
            )
          );

        const soldQty = Number(soldResult?.totalSold ?? 0);
        const purchaseReturnedQty = Number(
          purchaseReturnedResult?.totalReturned ?? 0
        );
        const accountedQty = soldQty + purchaseReturnedQty;
        if (payload.quantity < accountedQty) {
          const batchInfo = existingStockMedicine.batch?.trim()
            ? `batch '${existingStockMedicine.batch.trim()}'`
            : `this medicine`;
          throw new HttpError(
            400,
            `Cannot reduce quantity of ${batchInfo} to ${payload.quantity} as ${accountedQty} units have already been sold or returned to supplier`
          );
        }
      }

      // Calculate new total cost if quantity or cost updated
      let newTotalCost: number | undefined;
      if (payload.quantity !== undefined || payload.cost !== undefined) {
        const quantity =
          payload.quantity !== undefined
            ? payload.quantity
            : Number(existingStockMedicine.quantity);
        const cost =
          payload.cost !== undefined
            ? payload.cost
            : Number(existingStockMedicine.cost);
        newTotalCost = quantity * cost;
      }

      // Prepare update data
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (payload.batch !== undefined) updateData.batch = payload.batch;
      if (payload.expiry !== undefined)
        updateData.expiry = new Date(payload.expiry);
      if (payload.quantity !== undefined)
        updateData.quantity = payload.quantity;
      if (payload.mrp !== undefined) updateData.mrp = payload.mrp.toString();
      if (payload.cost !== undefined) updateData.cost = payload.cost.toString();
      if (newTotalCost !== undefined)
        updateData.totalCost = newTotalCost.toString();

      // Update stock medicine
      const [updatedStockMedicine] = await tx
        .update(PharmacyStockMedicineModel)
        .set(updateData)
        .where(eq(PharmacyStockMedicineModel.id, stockMedicineId))
        .returning();

      // After updating medicine, recalculate stock totals
      await this.recalculateStockTotals(
        existingStockMedicine.pharmacyStockId,
        tx
      );

      return updatedStockMedicine;
    });

    await this.refreshStockCacheMedicinesSafely(pharmacyId, [
      result.pharmacyMedicineId,
    ]);

    return result;
  }

  private static async recalculateStockTotals(stockId: string, tx: any) {
    const medicines = await tx
      .select({
        totalCost: PharmacyStockMedicineModel.totalCost,
      })
      .from(PharmacyStockMedicineModel)
      .where(eq(PharmacyStockMedicineModel.pharmacyStockId, stockId));

    const newTotalAmount = medicines.reduce(
      (sum: number, medicine: { totalCost: string | null }) => {
        return sum + (Number(medicine.totalCost) || 0);
      },
      0
    );

    const unit = medicines.length;

    await tx
      .update(PharmacyStockModel)
      .set({
        unit: unit,
        totalAmount: newTotalAmount.toString(),
        updatedAt: new Date(),
      })
      .where(eq(PharmacyStockModel.id, stockId));
  }

  static async updateStockInvoice(
    stockId: string,
    invoiceUrl: string | null,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      const [existingStock] = await tx
        .select({
          id: PharmacyStockModel.id,
          invoice: PharmacyStockModel.invoice,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.id, stockId),
            eq(PharmacyStockModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingStock) {
        throw new HttpError(404, 'Stock entry not found');
      }

      if (invoiceUrl && existingStock.invoice) {
        try {
          await deleteFromS3(existingStock.invoice);
        } catch {
          logger.error('Invoice not deleted');
        }
      }

      const [updatedStock] = await tx
        .update(PharmacyStockModel)
        .set({
          invoice: invoiceUrl,
          updatedAt: new Date(),
        })
        .where(eq(PharmacyStockModel.id, stockId))
        .returning();

      return updatedStock;
    });
  }

  static async getAvailableStock(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
      category?: string;
      form?: string;
      medicineName?: string;
    }
  ) {
    // Verify pharmacy exists
    const [pharmacy] = await database
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

    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    // Build conditions for medicines
    const medicineConditions: any[] = [
      eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
      eq(pharmacyMedicineModel.status, 'active'),
    ];

    if (query.search) {
      const searchPattern = `%${query.search.trim()}%`;
      medicineConditions.push(
        or(
          ilike(pharmacyMedicineModel.medicineName, searchPattern),
          ilike(pharmacyMedicineModel.sku, searchPattern),
          ilike(pharmacyMedicineModel.brandName, searchPattern),
          ilike(pharmacyMedicineModel.composition, searchPattern)
        )
      );
    }

    if (query.category) {
      medicineConditions.push(
        eq(pharmacyMedicineModel.category, query.category)
      );
    }

    if (query.form) {
      medicineConditions.push(eq(pharmacyMedicineModel.form, query.form));
    }

    if (query.medicineName) {
      medicineConditions.push(
        ilike(pharmacyMedicineModel.medicineName, `%${query.medicineName}%`)
      );
    }

    const salesSub = database
      .select({
        batchId: PharmacySalesItemsModel.pharmacyStockMedicineId,
        soldQty:
          sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)`.as(
            'sold_qty'
          ),
      })
      .from(PharmacySalesItemsModel)
      .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId)
      .as('sales_sub');

    const returnsSub = database
      .select({
        batchId: PharmacySalesReturnItemsModel.stockMedicineId,
        returnedQty:
          sql<number>`COALESCE(SUM(${PharmacySalesReturnItemsModel.returnedQuantity}), 0)`.as(
            'returned_qty'
          ),
      })
      .from(PharmacySalesReturnItemsModel)
      .groupBy(PharmacySalesReturnItemsModel.stockMedicineId)
      .as('returns_sub');

    const purchaseReturnsSub = database
      .select({
        batchId: PharmacyPurchaseReturnItemsModel.stockMedicineId,
        returnedQty:
          sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`.as(
            'purchase_returned_qty'
          ),
      })
      .from(PharmacyPurchaseReturnItemsModel)
      .groupBy(PharmacyPurchaseReturnItemsModel.stockMedicineId)
      .as('purchase_returns_sub');

    // Base query to select medicines with available stock
    const baseQuery = database
      .select({
        id: pharmacyMedicineModel.id,
        medicineName: pharmacyMedicineModel.medicineName,
        sku: pharmacyMedicineModel.sku,
        brandName: pharmacyMedicineModel.brandName,
        composition: pharmacyMedicineModel.composition,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,
        shelf: pharmacyMedicineModel.shelf,
        packOf: pharmacyMedicineModel.packOf,
        tags: sql<string[]>`COALESCE(
          array_agg(DISTINCT ${PharmacyMedicineTagsModel.tag}) FILTER (WHERE ${PharmacyMedicineTagsModel.tag} IS NOT NULL),
          ARRAY[]::text[]
        )`,
      })
      .from(pharmacyMedicineModel)
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          pharmacyMedicineModel.id,
          PharmacyStockMedicineModel.pharmacyMedicineId
        )
      )
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(salesSub, eq(PharmacyStockMedicineModel.id, salesSub.batchId))
      .leftJoin(
        returnsSub,
        eq(PharmacyStockMedicineModel.id, returnsSub.batchId)
      )
      .leftJoin(
        purchaseReturnsSub,
        eq(PharmacyStockMedicineModel.id, purchaseReturnsSub.batchId)
      )
      .leftJoin(
        PharmacyTagsMapModel,
        eq(pharmacyMedicineModel.id, PharmacyTagsMapModel.medicineId)
      )
      .leftJoin(
        PharmacyMedicineTagsModel,
        eq(PharmacyTagsMapModel.tagId, PharmacyMedicineTagsModel.id)
      )
      .where(
        and(
          ...medicineConditions,
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          sql`${PharmacyStockMedicineModel.expiry} > NOW()`,
          sql`COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0) - COALESCE(${purchaseReturnsSub.returnedQty}, 0) > 0`
        )
      )
      .groupBy(pharmacyMedicineModel.id);

    // Get total count of medicines with available stock
    const totalCountResult = await database
      .select({ count: sql`COUNT(DISTINCT ${pharmacyMedicineModel.id})` })
      .from(pharmacyMedicineModel)
      .innerJoin(
        PharmacyStockMedicineModel,
        eq(
          pharmacyMedicineModel.id,
          PharmacyStockMedicineModel.pharmacyMedicineId
        )
      )
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(salesSub, eq(PharmacyStockMedicineModel.id, salesSub.batchId))
      .leftJoin(
        returnsSub,
        eq(PharmacyStockMedicineModel.id, returnsSub.batchId)
      )
      .leftJoin(
        purchaseReturnsSub,
        eq(PharmacyStockMedicineModel.id, purchaseReturnsSub.batchId)
      )
      .where(
        and(
          ...medicineConditions,
          eq(PharmacyStockModel.pharmacyId, pharmacyId),
          sql`${PharmacyStockMedicineModel.expiry} > NOW()`,
          sql`COALESCE(${PharmacyStockMedicineModel.quantity}, 0) - COALESCE(${salesSub.soldQty}, 0) + COALESCE(${returnsSub.returnedQty}, 0) - COALESCE(${purchaseReturnsSub.returnedQty}, 0) > 0`
        )
      );

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Fetch only the 25 matching medicines for this page
    const medicinesWithStock = await baseQuery
      .orderBy(pharmacyMedicineModel.medicineName)
      .limit(limit)
      .offset(offset);

    // Get all non-expired batches for all medicines in a single query
    const medicineIds = medicinesWithStock.map((medicine) => medicine.id);

    const allBatches = medicineIds.length
      ? await database
          .select({
            id: PharmacyStockMedicineModel.id,
            pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
            batch: PharmacyStockMedicineModel.batch,
            expiry: PharmacyStockMedicineModel.expiry,
            quantity: PharmacyStockMedicineModel.quantity,
            mrp: PharmacyStockMedicineModel.mrp,
            cost: PharmacyStockMedicineModel.cost,
            hsnId: pharmacyMedicineModel.hsnId,
            hsnCode: HsnTaxMasterModel.hsnCode,
            gstPercentage: HsnTaxMasterModel.gstPercentage,
          })
          .from(PharmacyStockMedicineModel)
          .leftJoin(
            PharmacyStockModel,
            eq(
              PharmacyStockMedicineModel.pharmacyStockId,
              PharmacyStockModel.id
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
              inArray(
                PharmacyStockMedicineModel.pharmacyMedicineId,
                medicineIds
              ),
              eq(PharmacyStockModel.pharmacyId, pharmacyId),
              sql`${PharmacyStockMedicineModel.expiry} > NOW()` // Only non-expired batches
            )
          )
          .orderBy(PharmacyStockMedicineModel.expiry)
      : [];

    // Get sold quantities for all those batches in a single grouped query
    const batchIds = allBatches.map((batch) => batch.id);

    const soldRows = batchIds.length
      ? await database
          .select({
            pharmacyStockMedicineId:
              PharmacySalesItemsModel.pharmacyStockMedicineId,
            totalSold: sql<number>`COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)`,
          })
          .from(PharmacySalesItemsModel)
          .where(
            inArray(PharmacySalesItemsModel.pharmacyStockMedicineId, batchIds)
          )
          .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId)
      : [];

    const soldById = new Map(
      soldRows.map((row) => [
        row.pharmacyStockMedicineId,
        Number(row.totalSold) || 0,
      ])
    );

    const returnedRows = batchIds.length
      ? await database
          .select({
            stockMedicineId: PharmacySalesReturnItemsModel.stockMedicineId,
            totalReturned: sql<number>`COALESCE(SUM(${PharmacySalesReturnItemsModel.returnedQuantity}), 0)`,
          })
          .from(PharmacySalesReturnItemsModel)
          .where(
            inArray(PharmacySalesReturnItemsModel.stockMedicineId, batchIds)
          )
          .groupBy(PharmacySalesReturnItemsModel.stockMedicineId)
      : [];

    const returnedById = new Map(
      returnedRows.map((row) => [
        row.stockMedicineId,
        Number(row.totalReturned) || 0,
      ])
    );

    const purchaseReturnedRows = batchIds.length
      ? await database
          .select({
            stockMedicineId: PharmacyPurchaseReturnItemsModel.stockMedicineId,
            totalReturned: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
          })
          .from(PharmacyPurchaseReturnItemsModel)
          .where(
            inArray(PharmacyPurchaseReturnItemsModel.stockMedicineId, batchIds)
          )
          .groupBy(PharmacyPurchaseReturnItemsModel.stockMedicineId)
      : [];

    const purchaseReturnedById = new Map(
      purchaseReturnedRows.map((row) => [
        row.stockMedicineId,
        Number(row.totalReturned) || 0,
      ])
    );

    const batchesByMedicineId = new Map<string, typeof allBatches>();
    for (const batch of allBatches) {
      const list = batchesByMedicineId.get(batch.pharmacyMedicineId) ?? [];
      list.push(batch);
      batchesByMedicineId.set(batch.pharmacyMedicineId, list);
    }

    // For each medicine, assemble available batches from the pre-fetched data
    const allMedicinesWithBatches = [];

    for (const medicine of medicinesWithStock) {
      const batches = batchesByMedicineId.get(medicine.id) ?? [];

      const availableBatches = [];
      let totalAvailableQuantity = 0;

      for (const batch of batches) {
        const soldQuantity = soldById.get(batch.id) || 0;
        const returnedQuantity = returnedById.get(batch.id) || 0;
        const purchaseReturnedQuantity =
          purchaseReturnedById.get(batch.id) || 0;
        const originalQuantity = Number(batch.quantity);
        const availableQuantity =
          originalQuantity -
          soldQuantity +
          returnedQuantity -
          purchaseReturnedQuantity;

        if (availableQuantity > 0) {
          totalAvailableQuantity += availableQuantity;
          availableBatches.push({
            id: batch.id,
            batch: batch.batch,
            expiry: batch.expiry,
            quantity: availableQuantity,
            mrp: Number(batch.mrp),
            cost: Number(batch.cost),
            gstPercentage: Number(batch.gstPercentage) || 0,
          });
        }
      }

      // Only include medicines that have at least one available batch
      if (availableBatches.length > 0) {
        allMedicinesWithBatches.push({
          id: medicine.id,
          medicineName: medicine.medicineName,
          sku: medicine.sku,
          brandName: medicine.brandName,
          composition: medicine.composition,
          category: medicine.category,
          form: medicine.form,
          shelf: medicine.shelf,
          packOf: medicine.packOf,
          availableQuantity: totalAvailableQuantity,
          tags: medicine.tags || [],
          medicineAvailable: availableBatches,
        });
      }
    }

    return {
      stocks: allMedicinesWithBatches,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async exportAllStock(pharmacyId: string) {
    const [pharmacy] = await database
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

    const stocks = await database
      .select({
        stockId: PharmacyStockModel.id,

        purchaseDate: PharmacyStockModel.purchaseDate,

        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,

        paymentStatus: PharmacyStockModel.pharmacyStockPaymentStatus,
        paymentNotes: PharmacyStockModel.paymentNotes,

        units: PharmacyStockModel.unit,
        totalAmount: PharmacyStockModel.totalAmount,
        invoice: PharmacyStockModel.invoice,

        sku: pharmacyMedicineModel.sku,
        medicineName: pharmacyMedicineModel.medicineName,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,

        batch: PharmacyStockMedicineModel.batch,
        expiry: PharmacyStockMedicineModel.expiry,
        quantity: PharmacyStockMedicineModel.quantity,
        mrp: PharmacyStockMedicineModel.mrp,
        cost: PharmacyStockMedicineModel.cost,
        totalCost: PharmacyStockMedicineModel.totalCost,
      })
      .from(PharmacyStockMedicineModel)
      .leftJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(
        PharmacySupplierModel,
        eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id)
      )
      .leftJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(eq(PharmacyStockModel.pharmacyId, pharmacyId))
      .orderBy(desc(PharmacyStockModel.createdAt));

    return stocks.map((stock) => ({
      stockId: stock.stockId,

      purchaseDate: stock.purchaseDate
        ? new Date(stock.purchaseDate).toLocaleDateString('en-GB')
        : '',

      supplierName: stock.supplierName,
      contactPerson: stock.contactPerson,
      phone: stock.phone,

      paymentStatus: stock.paymentStatus,
      paymentNotes: stock.paymentNotes,

      units: stock.units,
      totalAmount: stock.totalAmount,
      invoice: stock.invoice,

      sku: stock.sku,
      medicineName: stock.medicineName,
      category: stock.category,
      form: stock.form,

      batch: stock.batch,

      expiry: stock.expiry
        ? new Date(stock.expiry).toLocaleDateString('en-GB')
        : '',

      quantity: stock.quantity,
      mrp: stock.mrp,
      cost: stock.cost,
      totalCost: stock.totalCost,
    }));
  }

  static async generateStockSampleTemplate(pharmacyId: string) {
    const workbook = new ExcelJS.Workbook();

    const templateSheet = workbook.addWorksheet('Stock Upload');
    const medicineSheet = workbook.addWorksheet('Medicine Master');
    const supplierSheet = workbook.addWorksheet('Supplier Master');

    const medicines = await database
      .select({
        medicineName: pharmacyMedicineModel.medicineName,
      })
      .from(pharmacyMedicineModel)
      .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId));

    const suppliers = await database
      .select({
        supplierName: PharmacySupplierModel.supplierName,
      })
      .from(PharmacySupplierModel)
      .where(eq(PharmacySupplierModel.pharmacyId, pharmacyId));

    // ==================================================
    // Instruction Row
    // ==================================================

    templateSheet.mergeCells('A1:K1');

    const instructionCell = templateSheet.getCell('A1');

    instructionCell.value =
      'Same Stock Number = same purchase | Purchase & Expiry Date: DD-MM-YYYY | Batch max 50 chars | Qty > 0 | MRP > 0 | Cost > 0 | Payment Notes max 100 chars';

    instructionCell.font = {
      bold: true,
      color: { argb: 'FFFF0000' },
    };

    instructionCell.alignment = {
      horizontal: 'left',
      vertical: 'middle',
    };

    // ==================================================
    // Column Widths
    // ==================================================

    templateSheet.columns = [
      { key: 'stockNumber', width: 20 },
      { key: 'supplierName', width: 30 },
      { key: 'purchaseDate', width: 20 },
      { key: 'paymentStatus', width: 20 },
      { key: 'paymentNotes', width: 30 },
      { key: 'medicineName', width: 35 },
      { key: 'batch', width: 20 },
      { key: 'expiry', width: 20 },
      { key: 'quantity', width: 15 },
      { key: 'mrp', width: 20 },
      { key: 'cost', width: 20 },
    ];

    // ==================================================
    // Header Row (Row 2)
    // ==================================================

    templateSheet.insertRow(2, [
      'Stock Number *',
      'Supplier Name (Optional)',
      'Purchase Date *',
      'Payment Status *',
      'Payment Notes (Optional)',
      'Medicine Name *',
      'Batch Number *',
      'Expiry Date *',
      'Quantity *',
      'MRP (Single Unit) *',
      'Cost (Single Unit) *',
    ]);

    const headerRow = templateSheet.getRow(2);

    headerRow.font = {
      bold: true,
    };

    const mandatoryHeaderFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: '92D050' },
    };

    const optionalHeaderFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFD966' },
    };

    const headerBorder = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    ['A2', 'C2', 'D2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2'].forEach((cell) => {
      templateSheet.getCell(cell).fill = mandatoryHeaderFill;
      templateSheet.getCell(cell).border = headerBorder;
    });

    ['B2', 'E2'].forEach((cell) => {
      templateSheet.getCell(cell).fill = optionalHeaderFill;
      templateSheet.getCell(cell).border = headerBorder;
    });

    templateSheet.getRow(1).alignment = {
      vertical: 'middle',
      horizontal: 'left',
    };

    // ==================================================
    // Freeze Header
    // ==================================================

    templateSheet.views = [
      {
        state: 'frozen',
        ySplit: 2,
      },
    ];

    // ==================================================
    // Header Notes
    // ==================================================

    templateSheet.getCell('A2').note =
      'Required. Used only for grouping rows into one stock entry. Not saved in database.';

    templateSheet.getCell('B2').note =
      'Optional. Must match an existing supplier name.';

    templateSheet.getCell('C2').note = 'Required. Format: YYYY-MM-DD';

    templateSheet.getCell('D2').note =
      'Required. Allowed values: paid, unpaid, partial';

    templateSheet.getCell('E2').note = 'Optional payment notes.';

    templateSheet.getCell('F2').note = 'Required. Select an existing medicine.';

    templateSheet.getCell('G2').note =
      'Required. Batch must be unique for a medicine.';

    templateSheet.getCell('H2').note = 'Required. Format: YYYY-MM-DD';

    templateSheet.getCell('I2').note = 'Required. Positive whole number.';

    templateSheet.getCell('J2').note = 'Required. Selling MRP.';

    templateSheet.getCell('K2').note = 'Required. Purchase Cost.';

    // ==================================================
    // Medicine Master
    // ==================================================

    medicineSheet.columns = [
      {
        header: 'Medicine Name',
        key: 'medicineName',
        width: 40,
      },
    ];

    medicineSheet.getRow(1).font = {
      bold: true,
    };

    medicines.forEach((medicine) => {
      medicineSheet.addRow({
        medicineName: medicine.medicineName,
      });
    });

    // ==================================================
    // Supplier Master
    // ==================================================

    supplierSheet.columns = [
      {
        header: 'Supplier Name',
        key: 'supplierName',
        width: 40,
      },
    ];

    supplierSheet.getRow(1).font = {
      bold: true,
    };

    suppliers.forEach((supplier) => {
      supplierSheet.addRow({
        supplierName: supplier.supplierName,
      });
    });

    const lastMedicineRow = medicines.length + 1;
    const lastSupplierRow = suppliers.length + 1;

    // ==================================================
    // Dropdown Validations
    // ==================================================

    for (let row = 3; row <= 1000; row++) {
      // Supplier Dropdown

      templateSheet.getCell(`B${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'Supplier Master'!$A$2:$A$${lastSupplierRow}`],
      };

      // Medicine Dropdown

      templateSheet.getCell(`F${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`'Medicine Master'!$A$2:$A$${lastMedicineRow}`],
      };

      // Payment Status

      templateSheet.getCell(`D${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"paid,unpaid,partial"'],
      };

      // Quantity

      templateSheet.getCell(`I${row}`).dataValidation = {
        type: 'whole',
        operator: 'greaterThan',
        formulae: [0],
        allowBlank: false,
        showErrorMessage: true,
        errorTitle: 'Invalid Quantity',
        error: 'Quantity must be greater than 0',
      };

      // MRP

      templateSheet.getCell(`J${row}`).dataValidation = {
        type: 'decimal',
        operator: 'greaterThan',
        formulae: [0],
        allowBlank: false,
      };

      // Cost

      templateSheet.getCell(`K${row}`).dataValidation = {
        type: 'decimal',
        operator: 'greaterThan',
        formulae: [0],
        allowBlank: false,
      };
    }

    // ==================================================
    // Blank Rows
    // ==================================================

    for (let i = 0; i < 100; i++) {
      templateSheet.addRow({
        stockNumber: '',
        supplierName: '',
        purchaseDate: '',
        paymentStatus: '',
        paymentNotes: '',
        medicineName: '',
        batch: '',
        expiry: '',
        quantity: '',
        mrp: '',
        cost: '',
      });
    }

    // ==================================================
    // Hide Master Sheets
    // ==================================================

    medicineSheet.state = 'hidden';
    supplierSheet.state = 'hidden';

    return workbook;
  }

  static async importStockFromExcel(pharmacyId: string, fileBuffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new HttpError(400, 'Excel sheet not found');
    }

    const insertedStocks: string[] = [];
    const insertedMedicines: string[] = [];
    const errors: string[] = [];

    // Helper function to safely get string value from Excel cell
    const getStringValue = (value: any): string => {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) {
        // Format date as DD-MM-YYYY
        const day = value.getDate().toString().padStart(2, '0');
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const year = value.getFullYear();
        return `${day}-${month}-${year}`;
      }
      return String(value).trim();
    };

    // Helper function to safely get number value from Excel cell
    const getNumberValue = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
      }
      if (value instanceof Date) return null;
      return null;
    };

    // Helper function to parse date from DD-MM-YYYY format
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr) return null;

      // Try DD-MM-YYYY format
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // Fallback to regular date parsing
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    };

    // Group rows by stock number for validation only (not stored)
    const stockGroups = new Map<string, any[]>();

    // First pass: Validate and group rows by stock number
    for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      const stockNumber = getStringValue(row.getCell(1).value);
      const supplierName = getStringValue(row.getCell(2).value);
      const purchaseDateStr = getStringValue(row.getCell(3).value);
      const paymentStatus = getStringValue(row.getCell(4).value);
      const paymentNotes = getStringValue(row.getCell(5).value);
      const medicineName = getStringValue(row.getCell(6).value);
      const batch = getStringValue(row.getCell(7).value);
      const expiryStr = getStringValue(row.getCell(8).value);
      const quantityRaw = row.getCell(9).value;
      const mrpRaw = row.getCell(10).value;
      const costRaw = row.getCell(11).value;

      // Check if row is empty
      const isEmpty =
        !stockNumber &&
        !supplierName &&
        !purchaseDateStr &&
        !paymentStatus &&
        !medicineName &&
        !batch &&
        !expiryStr &&
        !quantityRaw &&
        !mrpRaw &&
        !costRaw;

      if (isEmpty) {
        continue;
      }

      // Validate required fields
      if (!stockNumber) {
        errors.push(`Row ${rowNumber}: Stock Number is required for grouping`);
        continue;
      }

      if (!purchaseDateStr) {
        errors.push(`Row ${rowNumber}: Purchase Date is required`);
        continue;
      }

      // Parse purchase date
      const purchaseDate = parseDate(purchaseDateStr);
      if (!purchaseDate) {
        errors.push(
          `Row ${rowNumber}: Invalid Purchase Date format. Use DD-MM-YYYY (e.g., 15-06-2024)`
        );
        continue;
      }

      if (!paymentStatus) {
        errors.push(`Row ${rowNumber}: Payment Status is required`);
        continue;
      }

      const validPaymentStatuses = ['paid', 'unpaid', 'partial'];
      if (!validPaymentStatuses.includes(paymentStatus)) {
        errors.push(
          `Row ${rowNumber}: Payment Status must be one of: ${validPaymentStatuses.join(', ')}`
        );
        continue;
      }

      if (paymentNotes && paymentNotes.length > 100) {
        errors.push(
          `Row ${rowNumber}: Payment Notes must not exceed 100 characters`
        );
        continue;
      }

      if (!medicineName) {
        errors.push(`Row ${rowNumber}: Medicine Name is required`);
        continue;
      }

      if (medicineName.length > 200) {
        errors.push(
          `Row ${rowNumber}: Medicine Name exceeds maximum length of 200 characters`
        );
        continue;
      }

      if (!batch) {
        errors.push(`Row ${rowNumber}: Batch Number is required`);
        continue;
      }

      if (batch.length > 50) {
        errors.push(
          `Row ${rowNumber}: Batch Number exceeds maximum length of 50 characters`
        );
        continue;
      }

      if (!expiryStr) {
        errors.push(`Row ${rowNumber}: Expiry Date is required`);
        continue;
      }

      // Parse expiry date
      const expiryDate = parseDate(expiryStr);
      if (!expiryDate) {
        errors.push(
          `Row ${rowNumber}: Invalid Expiry Date format. Use DD-MM-YYYY (e.g., 31-12-2025)`
        );
        continue;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (expiryDate <= today) {
        errors.push(`Row ${rowNumber}: Expiry Date must be a future date`);
        continue;
      }

      if (expiryDate <= purchaseDate) {
        errors.push(
          `Row ${rowNumber}: Expiry Date must be after Purchase Date`
        );
        continue;
      }

      if (!quantityRaw && quantityRaw !== 0) {
        errors.push(`Row ${rowNumber}: Quantity is required`);
        continue;
      }

      const quantity = getNumberValue(quantityRaw);
      if (
        quantity === null ||
        isNaN(quantity) ||
        quantity <= 0 ||
        !Number.isInteger(quantity)
      ) {
        errors.push(
          `Row ${rowNumber}: Quantity must be a positive whole number`
        );
        continue;
      }

      if (!mrpRaw && mrpRaw !== 0) {
        errors.push(`Row ${rowNumber}: MRP is required`);
        continue;
      }

      const mrp = getNumberValue(mrpRaw);
      if (mrp === null || isNaN(mrp) || mrp <= 0) {
        errors.push(`Row ${rowNumber}: MRP must be a positive number`);
        continue;
      }

      if (!costRaw && costRaw !== 0) {
        errors.push(`Row ${rowNumber}: Cost is required`);
        continue;
      }

      const cost = getNumberValue(costRaw);
      if (cost === null || isNaN(cost) || cost <= 0) {
        errors.push(`Row ${rowNumber}: Cost must be a positive number`);
        continue;
      }

      if (cost > mrp) {
        errors.push(
          `Row ${rowNumber}: Cost (₹${cost}) cannot be greater than MRP (₹${mrp})`
        );
        continue;
      }

      // Group by stock number for consistency validation
      if (!stockGroups.has(stockNumber)) {
        stockGroups.set(stockNumber, []);
      }

      stockGroups.get(stockNumber)!.push({
        rowNumber,
        stockNumber,
        supplierName,
        purchaseDate,
        paymentStatus,
        paymentNotes: paymentNotes || null,
        medicineName,
        batch,
        expiryDate,
        quantity,
        mrp,
        cost,
      });
    }

    // If there are validation errors, return early
    if (errors.length > 0) {
      return {
        totalStocks: 0,
        totalMedicines: 0,
        totalErrors: errors.length,
        insertedStocks: [],
        insertedMedicines: [],
        errors,
      };
    }

    // Second pass: Validate consistency within each stock group
    for (const [stockNumber, rows] of stockGroups.entries()) {
      const firstRow = rows[0];
      const inconsistencies: string[] = [];

      // Check for consistent supplier name when supplied. Blank supplier cells are allowed.
      const firstSupplierName =
        rows.find((row) => row.supplierName)?.supplierName || '';
      for (let i = 1; i < rows.length; i++) {
        if (
          rows[i].supplierName &&
          firstSupplierName &&
          rows[i].supplierName !== firstSupplierName
        ) {
          inconsistencies.push(
            `Row ${rows[i].rowNumber}: Supplier name "${rows[i].supplierName}" doesn't match supplier "${firstSupplierName}"`
          );
        }
      }

      // Check for consistent purchase date
      for (let i = 1; i < rows.length; i++) {
        if (
          rows[i].purchaseDate.getTime() !== firstRow.purchaseDate.getTime()
        ) {
          inconsistencies.push(
            `Row ${rows[i].rowNumber}: Purchase date doesn't match first row's date`
          );
        }
      }

      // Check for consistent payment status
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].paymentStatus !== firstRow.paymentStatus) {
          inconsistencies.push(
            `Row ${rows[i].rowNumber}: Payment status "${rows[i].paymentStatus}" doesn't match first row's status "${firstRow.paymentStatus}"`
          );
        }
      }

      // Check for consistent payment notes
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].paymentNotes !== firstRow.paymentNotes) {
          inconsistencies.push(
            `Row ${rows[i].rowNumber}: Payment notes differ from first row`
          );
        }
      }

      if (inconsistencies.length > 0) {
        errors.push(
          `Stock Number "${stockNumber}": Inconsistent data found -`,
          ...inconsistencies
        );
        stockGroups.delete(stockNumber);
        continue;
      }

      // Check duplicate medicine + batch pairs within the same stock group.
      // Different medicines can share a batch number, and the same medicine can have different batches.
      const batchesInGroup = new Map<string, number>();
      for (const row of rows) {
        const batchKey = `${row.medicineName.toLowerCase()}|${row.batch}`;
        if (batchesInGroup.has(batchKey)) {
          errors.push(
            `Stock Number "${stockNumber}": Duplicate batch "${row.batch}" for medicine "${row.medicineName}" found in rows ${batchesInGroup.get(batchKey)} and ${row.rowNumber}`
          );
          stockGroups.delete(stockNumber);
          break;
        }
        batchesInGroup.set(batchKey, row.rowNumber);
      }
    }

    // Process each stock group - CREATE NEW (no updates)
    for (const [stockNumber, rows] of stockGroups.entries()) {
      try {
        await database.transaction(async (tx) => {
          const firstRow = rows[0];

          const supplierName =
            rows.find((row) => row.supplierName)?.supplierName || '';
          let supplierId: string | null = null;

          if (supplierName) {
            const [supplier] = await tx
              .select({ id: PharmacySupplierModel.id })
              .from(PharmacySupplierModel)
              .where(
                and(
                  eq(PharmacySupplierModel.pharmacyId, pharmacyId),
                  eq(PharmacySupplierModel.supplierName, supplierName)
                )
              )
              .limit(1);

            if (!supplier) {
              throw new Error(
                `Supplier "${supplierName}" not found. Please add supplier first.`
              );
            }

            supplierId = supplier.id;
          }

          // Calculate totals
          let totalAmount = 0;
          const numberOfMedicines = rows.length;

          for (const row of rows) {
            totalAmount += row.quantity * row.cost;
          }

          // Create NEW stock record (stock number not stored)
          const [stock] = await tx
            .insert(PharmacyStockModel)
            .values({
              pharmacyId,
              pharmacySupplierId: supplierId,
              purchaseDate: firstRow.purchaseDate,
              invoice: sql`NULL`,
              pharmacyStockPaymentStatus: firstRow.paymentStatus as any,
              paymentNotes: firstRow.paymentNotes,
              unit: numberOfMedicines,
              totalAmount: totalAmount.toFixed(2),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          insertedStocks.push(
            `Stock Entry (Ref: ${stock.id.slice(0, 8)}): ${supplierName || 'No supplier'}, ` +
              `Date: ${firstRow.purchaseDate.toLocaleDateString('en-GB')}, ` +
              `Total: ${numberOfMedicines} units, Amount: ₹${totalAmount.toFixed(2)}`
          );

          // Create stock medicine records
          for (const row of rows) {
            // Get medicine ID
            const [medicine] = await tx
              .select({ id: pharmacyMedicineModel.id })
              .from(pharmacyMedicineModel)
              .where(
                and(
                  eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
                  eq(pharmacyMedicineModel.medicineName, row.medicineName)
                )
              )
              .limit(1);

            if (!medicine) {
              throw new Error(
                `Medicine "${row.medicineName}" not found in your inventory`
              );
            }

            const totalCost = row.quantity * row.cost;

            await tx.insert(PharmacyStockMedicineModel).values({
              pharmacyStockId: stock.id,
              pharmacyMedicineId: medicine.id,
              batch: row.batch,
              expiry: row.expiryDate,
              quantity: row.quantity,
              mrp: row.mrp.toString(),
              cost: row.cost.toString(),
              totalCost: totalCost.toString(),
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            insertedMedicines.push(
              `Row ${row.rowNumber}: ${row.medicineName} (Batch: ${row.batch}) - ` +
                `${row.quantity} units @ ₹${row.cost} = ₹${totalCost}`
            );
          }
        });
      } catch (error) {
        errors.push(
          `Stock Group "${stockNumber}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return {
      totalStocks: insertedStocks.length,
      totalMedicines: insertedMedicines.length,
      totalErrors: errors.length,
      insertedStocks,
      insertedMedicines,
      errors,
      hasErrors: errors.length > 0,
      message:
        errors.length > 0
          ? `Stock import completed with ${errors.length} error(s). No data was imported for groups with errors.`
          : `Successfully imported ${insertedStocks.length} stock entries with ${insertedMedicines.length} medicines`,
    };
  }

  static async getStockStats(pharmacyId: string) {
    const now = new Date();
    const currentMonthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );

    const currentMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      0,
      0,
      0,
      0
    );

    const previousMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999
    );

    const [
      currentPurchaseAmount,
      previousPurchaseAmount,

      currentPurchaseEntries,
      previousPurchaseEntries,

      currentUnitsPurchased,
      previousUnitsPurchased,

      currentPaidAmount,
      previousPaidAmount,

      currentPurchaseReturns,
      previousPurchaseReturns,

      currentUnitsReturned,
      previousUnitsReturned,
    ] = await Promise.all([
      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, currentMonthStart),
            lte(PharmacyStockModel.purchaseDate, currentMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, previousMonthStart),
            lte(PharmacyStockModel.purchaseDate, previousMonthEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, currentMonthStart),
            lte(PharmacyStockModel.purchaseDate, currentMonthEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, previousMonthStart),
            lte(PharmacyStockModel.purchaseDate, previousMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.unit}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, currentMonthStart),
            lte(PharmacyStockModel.purchaseDate, currentMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.unit}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            gte(PharmacyStockModel.purchaseDate, previousMonthStart),
            lte(PharmacyStockModel.purchaseDate, previousMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            eq(PharmacyStockModel.pharmacyStockPaymentStatus, 'paid'),
            gte(PharmacyStockModel.purchaseDate, currentMonthStart),
            lte(PharmacyStockModel.purchaseDate, currentMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyStockModel.totalAmount}), 0)`,
        })
        .from(PharmacyStockModel)
        .where(
          and(
            eq(PharmacyStockModel.pharmacyId, pharmacyId),
            eq(PharmacyStockModel.pharmacyStockPaymentStatus, 'paid'),
            gte(PharmacyStockModel.purchaseDate, previousMonthStart),
            lte(PharmacyStockModel.purchaseDate, previousMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnModel.totalReturnAmount}), 0)`,
        })
        .from(PharmacyPurchaseReturnModel)
        .where(
          and(
            eq(PharmacyPurchaseReturnModel.pharmacyId, pharmacyId),
            gte(PharmacyPurchaseReturnModel.createdAt, currentMonthStart),
            lte(PharmacyPurchaseReturnModel.createdAt, currentMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnModel.totalReturnAmount}), 0)`,
        })
        .from(PharmacyPurchaseReturnModel)
        .where(
          and(
            eq(PharmacyPurchaseReturnModel.pharmacyId, pharmacyId),
            gte(PharmacyPurchaseReturnModel.createdAt, previousMonthStart),
            lte(PharmacyPurchaseReturnModel.createdAt, previousMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
        })
        .from(PharmacyPurchaseReturnItemsModel)
        .innerJoin(
          PharmacyPurchaseReturnModel,
          eq(
            PharmacyPurchaseReturnModel.id,
            PharmacyPurchaseReturnItemsModel.purchaseReturnId
          )
        )
        .where(
          and(
            eq(PharmacyPurchaseReturnModel.pharmacyId, pharmacyId),
            gte(PharmacyPurchaseReturnModel.createdAt, currentMonthStart),
            lte(PharmacyPurchaseReturnModel.createdAt, currentMonthEnd)
          )
        ),

      database
        .select({
          total: sql<number>`COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)`,
        })
        .from(PharmacyPurchaseReturnItemsModel)
        .innerJoin(
          PharmacyPurchaseReturnModel,
          eq(
            PharmacyPurchaseReturnModel.id,
            PharmacyPurchaseReturnItemsModel.purchaseReturnId
          )
        )
        .where(
          and(
            eq(PharmacyPurchaseReturnModel.pharmacyId, pharmacyId),
            gte(PharmacyPurchaseReturnModel.createdAt, previousMonthStart),
            lte(PharmacyPurchaseReturnModel.createdAt, previousMonthEnd)
          )
        ),
    ]);

    const percentageChange = (current: number, previous: number) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }

      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    const purchaseAmountCurrent = Number(currentPurchaseAmount[0]?.total || 0);
    const purchaseAmountPrevious = Number(
      previousPurchaseAmount[0]?.total || 0
    );

    const purchaseEntriesCurrent = Number(
      currentPurchaseEntries[0]?.count || 0
    );
    const purchaseEntriesPrevious = Number(
      previousPurchaseEntries[0]?.count || 0
    );

    const unitsCurrent = Number(currentUnitsPurchased[0]?.total || 0);
    const unitsPrevious = Number(previousUnitsPurchased[0]?.total || 0);

    const paidAmountCurrent = Number(currentPaidAmount[0]?.total || 0);
    const paidAmountPrevious = Number(previousPaidAmount[0]?.total || 0);

    const purchaseReturnAmountCurrent = Number(
      currentPurchaseReturns[0]?.total || 0
    );
    const purchaseReturnAmountPrevious = Number(
      previousPurchaseReturns[0]?.total || 0
    );

    const unitsReturnedCurrent = Number(currentUnitsReturned[0]?.total || 0);
    const unitsReturnedPrevious = Number(previousUnitsReturned[0]?.total || 0);

    return {
      totalPurchaseAmount: {
        value: purchaseAmountCurrent,
        percentageChange: percentageChange(
          purchaseAmountCurrent,
          purchaseAmountPrevious
        ),
        trend:
          purchaseAmountCurrent >= purchaseAmountPrevious
            ? 'increase'
            : 'decrease',
      },

      totalPurchaseEntries: {
        value: purchaseEntriesCurrent,
        percentageChange: percentageChange(
          purchaseEntriesCurrent,
          purchaseEntriesPrevious
        ),
        trend:
          purchaseEntriesCurrent >= purchaseEntriesPrevious
            ? 'increase'
            : 'decrease',
      },

      totalUnitsPurchased: {
        value: unitsCurrent,
        percentageChange: percentageChange(unitsCurrent, unitsPrevious),
        trend: unitsCurrent >= unitsPrevious ? 'increase' : 'decrease',
      },

      paidAmount: {
        value: paidAmountCurrent,
        percentageChange: percentageChange(
          paidAmountCurrent,
          paidAmountPrevious
        ),
        trend:
          paidAmountCurrent >= paidAmountPrevious ? 'increase' : 'decrease',
      },

      totalPurchaseReturns: {
        value: purchaseReturnAmountCurrent,
        percentageChange: percentageChange(
          purchaseReturnAmountCurrent,
          purchaseReturnAmountPrevious
        ),
        trend:
          purchaseReturnAmountCurrent >= purchaseReturnAmountPrevious
            ? 'increase'
            : 'decrease',
      },

      totalUnitsReturnedToSupplier: {
        value: unitsReturnedCurrent,
        percentageChange: percentageChange(
          unitsReturnedCurrent,
          unitsReturnedPrevious
        ),
        trend:
          unitsReturnedCurrent >= unitsReturnedPrevious
            ? 'increase'
            : 'decrease',
      },
    };
  }

  static async getExpiryStock(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      medicineName?: string;
      expiryDays?: number;
    }
  ) {
    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const offset = (pageNumber - 1) * pageSize;

    const conditions: any[] = [eq(PharmacyStockModel.pharmacyId, pharmacyId)];

    if (query.medicineName) {
      conditions.push(
        or(
          ilike(pharmacyMedicineModel.medicineName, `%${query.medicineName}%`),
          ilike(pharmacyMedicineModel.sku, `%${query.medicineName}%`)
        )
      );
    }

    if (query.expiryDays !== undefined) {
      if (query.expiryDays === 0) {
        conditions.push(
          sql`${PharmacyStockMedicineModel.expiry} < CURRENT_DATE`
        );
      } else {
        conditions.push(sql`
          ${PharmacyStockMedicineModel.expiry} >= CURRENT_DATE
          AND
          ${PharmacyStockMedicineModel.expiry}
          <= CURRENT_DATE + (${query.expiryDays} * INTERVAL '1 day')
        `);
      }
    }

    const soldQuantitySql = sql<number>`
      (
        SELECT
          COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
          - COALESCE(SUM(return_sub.returned_quantity), 0)
        FROM ${PharmacySalesItemsModel}
        LEFT JOIN (
          SELECT
            ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
            SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
          FROM ${PharmacySalesReturnItemsModel}
          GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
        ) return_sub
          ON return_sub.sales_item_id = ${PharmacySalesItemsModel.id}
        WHERE ${PharmacySalesItemsModel.pharmacyStockMedicineId}
        = ${PharmacyStockMedicineModel.id}
      )
    `;

    const purchaseReturnedQuantitySql = sql<number>`
      (
        SELECT COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)
        FROM ${PharmacyPurchaseReturnItemsModel}
        WHERE ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
        = ${PharmacyStockMedicineModel.id}
      )
    `;

    const remainingQuantitySql = sql<number>`
      COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
      - (${soldQuantitySql})
      - (${purchaseReturnedQuantitySql})
    `;

    const data = await database
      .select({
        stockMedicineId: PharmacyStockMedicineModel.id,
        stockId: PharmacyStockModel.id,

        medicineId: pharmacyMedicineModel.id,
        medicineBrand: pharmacyMedicineModel.brandName,
        medicineName: pharmacyMedicineModel.medicineName,
        sku: pharmacyMedicineModel.sku,
        shelf: pharmacyMedicineModel.shelf,
        packOf: pharmacyMedicineModel.packOf,

        batch: PharmacyStockMedicineModel.batch,
        expiry: PharmacyStockMedicineModel.expiry,

        purchasedQuantity: PharmacyStockMedicineModel.quantity,

        soldQuantity: soldQuantitySql,

        purchaseReturnedQuantity: purchaseReturnedQuantitySql,

        remainingQuantity: remainingQuantitySql,

        mrp: PharmacyStockMedicineModel.mrp,
        cost: PharmacyStockMedicineModel.cost,

        supplierName: PharmacySupplierModel.supplierName,
        purchaseDate: PharmacyStockModel.purchaseDate,
      })
      .from(PharmacyStockMedicineModel)
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(
        PharmacySupplierModel,
        eq(PharmacyStockModel.pharmacySupplierId, PharmacySupplierModel.id)
      )
      .leftJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(
        and(
          ...conditions,
          sql`
            COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
            >
            (
              (
                SELECT
                  COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
                  - COALESCE(SUM(return_sub.returned_quantity), 0)
                FROM ${PharmacySalesItemsModel}
                LEFT JOIN (
                  SELECT
                    ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
                    SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
                  FROM ${PharmacySalesReturnItemsModel}
                  GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
                ) return_sub
                  ON return_sub.sales_item_id = ${PharmacySalesItemsModel.id}
                WHERE ${PharmacySalesItemsModel.pharmacyStockMedicineId}
                = ${PharmacyStockMedicineModel.id}
              )
              +
              (
                SELECT COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)
                FROM ${PharmacyPurchaseReturnItemsModel}
                WHERE ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
                = ${PharmacyStockMedicineModel.id}
              )
            )
          `
        )
      )
      .orderBy(asc(PharmacyStockMedicineModel.expiry))
      .limit(pageSize)
      .offset(offset);

    const [{ count }] = await database
      .select({
        count: sql<number>`count(*)`,
      })
      .from(PharmacyStockMedicineModel)
      .innerJoin(
        PharmacyStockModel,
        eq(PharmacyStockMedicineModel.pharmacyStockId, PharmacyStockModel.id)
      )
      .leftJoin(
        pharmacyMedicineModel,
        eq(
          PharmacyStockMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(
        and(
          ...conditions,
          sql`
            COALESCE(${PharmacyStockMedicineModel.quantity}, 0)
            >
            (
              (
                SELECT
                  COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
                  - COALESCE(SUM(return_sub.returned_quantity), 0)
                FROM ${PharmacySalesItemsModel}
                LEFT JOIN (
                  SELECT
                    ${PharmacySalesReturnItemsModel.salesItemId} AS sales_item_id,
                    SUM(${PharmacySalesReturnItemsModel.returnedQuantity}) AS returned_quantity
                  FROM ${PharmacySalesReturnItemsModel}
                  GROUP BY ${PharmacySalesReturnItemsModel.salesItemId}
                ) return_sub
                  ON return_sub.sales_item_id = ${PharmacySalesItemsModel.id}
                WHERE ${PharmacySalesItemsModel.pharmacyStockMedicineId}
                = ${PharmacyStockMedicineModel.id}
              )
              +
              (
                SELECT COALESCE(SUM(${PharmacyPurchaseReturnItemsModel.returnedQuantity}), 0)
                FROM ${PharmacyPurchaseReturnItemsModel}
                WHERE ${PharmacyPurchaseReturnItemsModel.stockMedicineId}
                = ${PharmacyStockMedicineModel.id}
              )
            )
          `
        )
      );

    const totalRecords = Number(count ?? 0);

    return {
      data,
      pagination: {
        totalRecords,
        totalPages: Math.ceil(totalRecords / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }
}
