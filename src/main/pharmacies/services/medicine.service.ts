import {
  and,
  eq,
  sql,
  or,
  ilike,
  desc,
  ne,
  isNotNull,
  gte,
  lte,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import ExcelJS from 'exceljs';
import {
  CreateMedicineInput,
  UpdateMedicineInput,
} from '../schemas/medicine.schema';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import { PharmacySalesReturnItemsModel } from '../models/pharmacySalesReturn.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import { inArray } from 'drizzle-orm';

export class PharmacyMedicineService {
  private static generateSku(
    medicineName: string,
    form?: string | null,
    hsnCode?: string | null
  ): string {
    const cleanName = medicineName.toUpperCase().replace(/[^A-Z0-9 ]/g, '');

    const namePart = cleanName
      .replace(/\d+/g, '')
      .replace(/\s+/g, '')
      .slice(0, 4);

    const numberPart = (medicineName.match(/\d+/g) || []).join('');

    const formPart = form
      ? form
          .replace(/[^A-Z]/gi, '')
          .toUpperCase()
          .slice(0, 3)
      : '';

    let sku = `${namePart}${numberPart}${formPart}`;

    if (sku.length < 6 && hsnCode) {
      sku += hsnCode.replace(/\D/g, '');
    }

    return sku.slice(0, 10);
  }

  static async createMedicine(
    payload: CreateMedicineInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
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

      const [hsn] = await tx
        .select({
          id: HsnTaxMasterModel.id,
          hsnCode: HsnTaxMasterModel.hsnCode,
        })
        .from(HsnTaxMasterModel)
        .where(eq(HsnTaxMasterModel.id, payload.hsnId))
        .limit(1);

      if (!hsn) {
        throw new HttpError(404, 'HSN code not found');
      }

      const [existingMedicine] = await tx
        .select({ id: pharmacyMedicineModel.id })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            eq(pharmacyMedicineModel.medicineName, payload.medicineName)
          )
        )
        .limit(1);

      if (existingMedicine) {
        throw new HttpError(
          400,
          'Medicine with this name already exists in this pharmacy'
        );
      }

      const sku = this.generateSku(
        payload.medicineName,
        payload.form,
        hsn.hsnCode
      );

      const [medicine] = await tx
        .insert(pharmacyMedicineModel)
        .values({
          pharmacyId: pharmacyId,
          medicineName: payload.medicineName,
          brandName: payload.brandName,
          composition: payload.composition,
          category: payload.category,
          hsnId: payload.hsnId,
          form: payload.form,
          shelf: payload.shelf,
          sku,
          reorder: payload.reorder,
          packOf: payload.packOf,
          status: payload.status,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      if (payload.tags && payload.tags.length > 0) {
        const uniqueTags = [...new Set(payload.tags.map((t) => t.trim()))];

        // Batch select existing tags for this pharmacy
        const existingTags = await tx
          .select({
            id: PharmacyMedicineTagsModel.id,
            tag: PharmacyMedicineTagsModel.tag,
          })
          .from(PharmacyMedicineTagsModel)
          .where(
            and(
              eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
              inArray(PharmacyMedicineTagsModel.tag, uniqueTags)
            )
          );

        const existingTagMap = new Map(
          existingTags.map((t) => [t.tag.toLowerCase(), t.id])
        );

        const newTagsToInsert = uniqueTags.filter(
          (tagName) => !existingTagMap.has(tagName.toLowerCase())
        );

        const allTagIds: string[] = [...existingTags.map((t) => t.id)];

        // Batch insert new tags
        if (newTagsToInsert.length > 0) {
          const insertedTags = await tx
            .insert(PharmacyMedicineTagsModel)
            .values(
              newTagsToInsert.map((tagName) => ({
                pharmacyId: pharmacyId,
                tag: tagName,
              }))
            )
            .returning({ id: PharmacyMedicineTagsModel.id });

          allTagIds.push(...insertedTags.map((t) => t.id));
        }

        // Batch insert mapping entries
        if (allTagIds.length > 0) {
          await tx.insert(PharmacyTagsMapModel).values(
            allTagIds.map((tagId) => ({
              medicineId: medicine.id,
              tagId: tagId,
            }))
          );
        }
      }

      return medicine;
    });
  }

  static async getMedicines(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
      category?: string;
      form?: string;
      status?: 'active' | 'inactive';
      hsnId?: string;
      stockStatus?: 'empty' | 'low' | 'medium' | 'good';
      tag?: string;
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
    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
      inArray(pharmacyMedicineModel.status, ['active', 'inactive']),
    ];

    if (query.status) {
      conditions.push(eq(pharmacyMedicineModel.status, query.status));
    }

    if (query.category) {
      conditions.push(eq(pharmacyMedicineModel.category, query.category));
    }

    if (query.form) {
      conditions.push(eq(pharmacyMedicineModel.form, query.form));
    }

    if (query.hsnId) {
      conditions.push(eq(pharmacyMedicineModel.hsnId, query.hsnId));
    }

    if (query.search && query.search.trim()) {
      const searchPattern = `%${query.search.trim()}%`;

      // First, find tag IDs that match the tag search for this pharmacy
      const matchingTags = await database
        .select({ id: PharmacyMedicineTagsModel.id })
        .from(PharmacyMedicineTagsModel)
        .where(
          and(
            eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
            ilike(PharmacyMedicineTagsModel.tag, searchPattern)
          )
        );

      const tagIds = matchingTags.map((t) => t.id);

      // Then find medicine IDs that have these tags
      let medicineIdsFromTags: string[] = [];
      if (tagIds.length > 0) {
        const medicinesWithMatchingTags = await database
          .select({ medicineId: PharmacyTagsMapModel.medicineId })
          .from(PharmacyTagsMapModel)
          .where(inArray(PharmacyTagsMapModel.tagId, tagIds))
          .groupBy(PharmacyTagsMapModel.medicineId);

        medicineIdsFromTags = medicinesWithMatchingTags.map(
          (m) => m.medicineId
        );
      }

      const medicineFieldConditions = [
        ilike(pharmacyMedicineModel.medicineName, searchPattern),
        ilike(pharmacyMedicineModel.brandName, searchPattern),
        ilike(pharmacyMedicineModel.composition, searchPattern),
        ilike(pharmacyMedicineModel.category, searchPattern),
        ilike(pharmacyMedicineModel.form, searchPattern),
        ilike(pharmacyMedicineModel.sku, searchPattern),
      ];

      if (medicineIdsFromTags.length > 0) {
        conditions.push(
          or(
            ...medicineFieldConditions,
            inArray(pharmacyMedicineModel.id, medicineIdsFromTags)
          )
        );
      } else {
        conditions.push(or(...medicineFieldConditions));
      }
    }

    if (query.tag?.trim()) {
      const matchingTags = await database
        .select({
          medicineId: PharmacyTagsMapModel.medicineId,
        })
        .from(PharmacyTagsMapModel)
        .innerJoin(
          PharmacyMedicineTagsModel,
          eq(PharmacyTagsMapModel.tagId, PharmacyMedicineTagsModel.id)
        )
        .where(
          and(
            eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
            ilike(PharmacyMedicineTagsModel.tag, query.tag.trim())
          )
        );

      const medicineIds = [...new Set(matchingTags.map((m) => m.medicineId))];

      if (medicineIds.length > 0) {
        conditions.push(inArray(pharmacyMedicineModel.id, medicineIds));
      } else {
        conditions.push(sql`1 = 0`);
      }
    }

    const allMedicines = await database
      .select({
        id: pharmacyMedicineModel.id,
        pharmacyId: pharmacyMedicineModel.pharmacyId,
        medicineName: pharmacyMedicineModel.medicineName,
        brandName: pharmacyMedicineModel.brandName,
        sku: pharmacyMedicineModel.sku,
        composition: pharmacyMedicineModel.composition,
        category: pharmacyMedicineModel.category,
        hsnId: pharmacyMedicineModel.hsnId,
        form: pharmacyMedicineModel.form,
        shelf: pharmacyMedicineModel.shelf,
        reorder: pharmacyMedicineModel.reorder,
        packOf: pharmacyMedicineModel.packOf,
        status: pharmacyMedicineModel.status,
        createdAt: pharmacyMedicineModel.createdAt,
        updatedAt: pharmacyMedicineModel.updatedAt,
        hsnCode: HsnTaxMasterModel.hsnCode,
        hsnGstPercentage: HsnTaxMasterModel.gstPercentage,
        description: HsnTaxMasterModel.description,
        effectiveFrom: HsnTaxMasterModel.effectiveFrom,
      })
      .from(pharmacyMedicineModel)
      .leftJoin(
        HsnTaxMasterModel,
        eq(pharmacyMedicineModel.hsnId, HsnTaxMasterModel.id)
      )
      .where(and(...conditions))
      .orderBy(desc(pharmacyMedicineModel.createdAt));

    const medicineIds = allMedicines.map((m) => m.id);
    const tagsMap = new Map<string, string[]>();

    if (medicineIds.length > 0) {
      const allTags = await database
        .select({
          medicineId: PharmacyTagsMapModel.medicineId,
          tag: PharmacyMedicineTagsModel.tag,
        })
        .from(PharmacyTagsMapModel)
        .leftJoin(
          PharmacyMedicineTagsModel,
          eq(PharmacyTagsMapModel.tagId, PharmacyMedicineTagsModel.id)
        )
        .where(
          and(
            inArray(PharmacyTagsMapModel.medicineId, medicineIds),
            eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId)
          )
        )
        .orderBy(PharmacyMedicineTagsModel.createdAt);

      for (const tagRecord of allTags) {
        if (!tagsMap.has(tagRecord.medicineId)) {
          tagsMap.set(tagRecord.medicineId, []);
        }
        if (tagRecord.tag) {
          tagsMap.get(tagRecord.medicineId)!.push(tagRecord.tag);
        }
      }
    }

    // Calculate available quantity and stock status for all medicines
    const medicinesWithDetails = await Promise.all(
      allMedicines.map(async (medicine) => {
        const batches = await database
          .select({
            id: PharmacyStockMedicineModel.id,
            quantity: PharmacyStockMedicineModel.quantity,
          })
          .from(PharmacyStockMedicineModel)
          .leftJoin(
            PharmacyStockModel,
            eq(
              PharmacyStockMedicineModel.pharmacyStockId,
              PharmacyStockModel.id
            )
          )
          .where(
            and(
              eq(PharmacyStockMedicineModel.pharmacyMedicineId, medicine.id),
              eq(PharmacyStockModel.pharmacyId, pharmacyId),
              sql`${PharmacyStockMedicineModel.expiry} > NOW()`
            )
          );

        let totalAvailableQuantity = 0;

        for (const batch of batches) {
          const soldResult = await database
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
              eq(PharmacySalesItemsModel.pharmacyStockMedicineId, batch.id)
            );

          const soldQuantity = Number(soldResult[0]?.totalSold) || 0;
          const originalQuantity = Number(batch.quantity);
          const availableQuantity = originalQuantity - soldQuantity;

          if (availableQuantity > 0) {
            totalAvailableQuantity += availableQuantity;
          }
        }

        const reorder = Number(medicine.reorder || 0);
        let stockStatus: 'empty' | 'low' | 'medium' | 'good' = 'empty';

        if (totalAvailableQuantity === 0) {
          stockStatus = 'empty';
        } else if (totalAvailableQuantity <= reorder) {
          stockStatus = 'low';
        } else if (totalAvailableQuantity <= reorder * 3) {
          stockStatus = 'medium';
        } else {
          stockStatus = 'good';
        }

        return {
          ...medicine,
          tags: tagsMap.get(medicine.id) || [],
          availableQuantity: totalAvailableQuantity,
          stockStatus,
        };
      })
    );

    // Apply stock status filter
    let filteredMedicines = medicinesWithDetails;
    if (query.stockStatus) {
      filteredMedicines = medicinesWithDetails.filter(
        (medicine) => medicine.stockStatus === query.stockStatus
      );
    }

    // Get filtered total count
    const filteredTotalCount = filteredMedicines.length;

    // Apply pagination to filtered results
    const paginatedMedicines = filteredMedicines.slice(offset, offset + limit);

    return {
      medicines: paginatedMedicines,
      pagination: {
        totalRecords: filteredTotalCount,
        totalPages: Math.ceil(filteredTotalCount / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async updateMedicine(
    id: string,
    payload: UpdateMedicineInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      const [existingMedicine] = await tx
        .select({
          id: pharmacyMedicineModel.id,
          pharmacyId: pharmacyMedicineModel.pharmacyId,
          medicineName: pharmacyMedicineModel.medicineName,
          hsnId: pharmacyMedicineModel.hsnId,
          form: pharmacyMedicineModel.form,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.id, id),
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingMedicine) {
        throw new HttpError(404, 'Medicine not found');
      }

      if (payload.hsnId) {
        const [hsn] = await tx
          .select({ id: HsnTaxMasterModel.id })
          .from(HsnTaxMasterModel)
          .where(eq(HsnTaxMasterModel.id, payload.hsnId))
          .limit(1);

        if (!hsn) {
          throw new HttpError(404, 'HSN code not found');
        }
      }

      if (
        payload.medicineName &&
        payload.medicineName !== existingMedicine.medicineName
      ) {
        const [duplicateName] = await tx
          .select({ id: pharmacyMedicineModel.id })
          .from(pharmacyMedicineModel)
          .where(
            and(
              eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
              eq(pharmacyMedicineModel.medicineName, payload.medicineName),
              ne(pharmacyMedicineModel.id, id)
            )
          )
          .limit(1);

        if (duplicateName) {
          throw new HttpError(
            400,
            'Medicine with this name already exists in this pharmacy'
          );
        }
      }

      let sku: string | undefined;

      if (
        payload.medicineName !== undefined ||
        payload.form !== undefined ||
        payload.hsnId !== undefined
      ) {
        const finalMedicineName =
          payload.medicineName ?? existingMedicine.medicineName;

        const finalForm = payload.form ?? existingMedicine.form;

        const finalHsnId = payload.hsnId ?? existingMedicine.hsnId;

        const [hsn] = await tx
          .select({
            hsnCode: HsnTaxMasterModel.hsnCode,
          })
          .from(HsnTaxMasterModel)
          .where(eq(HsnTaxMasterModel.id, finalHsnId))
          .limit(1);

        sku = this.generateSku(finalMedicineName, finalForm, hsn?.hsnCode);

        // Optional: ensure SKU uniqueness inside pharmacy
        let finalSku = sku;
        let counter = 1;

        while (true) {
          const [existingSku] = await tx
            .select({ id: pharmacyMedicineModel.id })
            .from(pharmacyMedicineModel)
            .where(
              and(
                eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
                eq(pharmacyMedicineModel.sku, finalSku),
                ne(pharmacyMedicineModel.id, id)
              )
            )
            .limit(1);

          if (!existingSku) {
            sku = finalSku;
            break;
          }

          finalSku = `${sku}${counter}`.slice(0, 10);
          counter++;
        }
      }

      const { tags, ...medicineUpdateData } = payload;

      const [updatedMedicine] = await tx
        .update(pharmacyMedicineModel)
        .set({
          ...medicineUpdateData,
          ...(sku ? { sku } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pharmacyMedicineModel.id, id))
        .returning();

      if (tags !== undefined) {
        await tx
          .delete(PharmacyTagsMapModel)
          .where(eq(PharmacyTagsMapModel.medicineId, id));

        if (tags && tags.length > 0) {
          const uniqueTags = [...new Set(tags.map((t) => t.trim()))];

          // Batch select existing tags for this pharmacy
          const existingTags = await tx
            .select({
              id: PharmacyMedicineTagsModel.id,
              tag: PharmacyMedicineTagsModel.tag,
            })
            .from(PharmacyMedicineTagsModel)
            .where(
              and(
                eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
                inArray(PharmacyMedicineTagsModel.tag, uniqueTags)
              )
            );

          const existingTagMap = new Map(
            existingTags.map((t) => [t.tag.toLowerCase(), t.id])
          );

          const newTagsToInsert = uniqueTags.filter(
            (tagName) => !existingTagMap.has(tagName.toLowerCase())
          );

          const allTagIds: string[] = [...existingTags.map((t) => t.id)];

          // Batch insert new tags
          if (newTagsToInsert.length > 0) {
            const insertedTags = await tx
              .insert(PharmacyMedicineTagsModel)
              .values(
                newTagsToInsert.map((tagName) => ({
                  pharmacyId,
                  tag: tagName,
                }))
              )
              .returning({
                id: PharmacyMedicineTagsModel.id,
              });

            allTagIds.push(...insertedTags.map((t) => t.id));
          }

          // Batch insert mapping entries
          if (allTagIds.length > 0) {
            await tx.insert(PharmacyTagsMapModel).values(
              allTagIds.map((tagId) => ({
                medicineId: id,
                tagId,
              }))
            );
          }
        }
      }

      return updatedMedicine;
    });
  }

  static async getMedicineCategories(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
    }
  ) {
    const pageSize = Math.max(Number(query.pageSize) || 10, 1);

    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);

    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
    ];

    conditions.push(isNotNull(pharmacyMedicineModel.category));

    if (query.search?.trim()) {
      conditions.push(
        ilike(pharmacyMedicineModel.category, `%${query.search.trim()}%`)
      );
    }

    const totalCountResult = await database
      .select({
        count: sql<number>`
          COUNT(DISTINCT ${pharmacyMedicineModel.category})
        `,
      })
      .from(pharmacyMedicineModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;

    const totalPages = Math.ceil(totalCount / pageSize);

    const categories = await database
      .select({
        category: pharmacyMedicineModel.category,
      })
      .from(pharmacyMedicineModel)
      .where(and(...conditions))
      .groupBy(pharmacyMedicineModel.category)
      .orderBy(pharmacyMedicineModel.category)
      .limit(limit)
      .offset(offset);

    return {
      categories: categories.map((item) => item.category),
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getMedicineTags(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
    }
  ) {
    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);

    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(PharmacyMedicineTagsModel.pharmacyId, pharmacyId),
    ];

    if (query.search?.trim()) {
      conditions.push(
        ilike(PharmacyMedicineTagsModel.tag, `%${query.search.trim()}%`)
      );
    }

    const totalCountResult = await database
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(PharmacyMedicineTagsModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;

    const tags = await database
      .select({
        tag: PharmacyMedicineTagsModel.tag,
      })
      .from(PharmacyMedicineTagsModel)
      .where(and(...conditions))
      .orderBy(PharmacyMedicineTagsModel.tag)
      .limit(limit)
      .offset(offset);

    return {
      tags: tags.map((item) => item.tag),
      pagination: {
        totalRecords: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getMedicineBrands(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
    }
  ) {
    const pageSize = Math.max(Number(query.pageSize) || 10, 1);

    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);

    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
    ];

    conditions.push(isNotNull(pharmacyMedicineModel.brandName));

    if (query.search?.trim()) {
      conditions.push(
        ilike(pharmacyMedicineModel.brandName, `%${query.search.trim()}%`)
      );
    }

    const totalCountResult = await database
      .select({
        count: sql<number>`
          COUNT(DISTINCT ${pharmacyMedicineModel.brandName})
        `,
      })
      .from(pharmacyMedicineModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;

    const totalPages = Math.ceil(totalCount / pageSize);

    const brands = await database
      .select({
        brandName: pharmacyMedicineModel.brandName,
      })
      .from(pharmacyMedicineModel)
      .where(and(...conditions))
      .groupBy(pharmacyMedicineModel.brandName)
      .orderBy(pharmacyMedicineModel.brandName)
      .limit(limit)
      .offset(offset);

    return {
      brands: brands.map((item) => item.brandName),
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async exportAllMedicines(pharmacyId: string) {
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

    const medicines = await database
      .select({
        id: pharmacyMedicineModel.id,
        sku: pharmacyMedicineModel.sku,
        medicineName: pharmacyMedicineModel.medicineName,
        brandName: pharmacyMedicineModel.brandName,
        composition: pharmacyMedicineModel.composition,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,
        shelf: pharmacyMedicineModel.shelf,
        reorder: pharmacyMedicineModel.reorder,
        packOf: pharmacyMedicineModel.packOf,
        status: pharmacyMedicineModel.status,
        hsnCode: HsnTaxMasterModel.hsnCode,
        hsnGstPercentage: HsnTaxMasterModel.gstPercentage,
      })
      .from(pharmacyMedicineModel)
      .leftJoin(
        HsnTaxMasterModel,
        eq(pharmacyMedicineModel.hsnId, HsnTaxMasterModel.id)
      )
      .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId))
      .orderBy(desc(pharmacyMedicineModel.createdAt));

    const medicinesWithAvailableQty = await Promise.all(
      medicines.map(async (medicine) => {
        const batches = await database
          .select({
            id: PharmacyStockMedicineModel.id,
            quantity: PharmacyStockMedicineModel.quantity,
          })
          .from(PharmacyStockMedicineModel)
          .leftJoin(
            PharmacyStockModel,
            eq(
              PharmacyStockMedicineModel.pharmacyStockId,
              PharmacyStockModel.id
            )
          )
          .where(
            and(
              eq(PharmacyStockMedicineModel.pharmacyMedicineId, medicine.id),
              eq(PharmacyStockModel.pharmacyId, pharmacyId),
              sql`${PharmacyStockMedicineModel.expiry} > NOW()`
            )
          );

        let totalAvailableQuantity = 0;

        for (const batch of batches) {
          const soldResult = await database
            .select({
              totalSold: sql<number>`
                COALESCE(
                  SUM(${PharmacySalesItemsModel.quantity}),
                  0
                )
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
              eq(PharmacySalesItemsModel.pharmacyStockMedicineId, batch.id)
            );

          const soldQuantity = Number(soldResult[0]?.totalSold) || 0;

          const originalQuantity = Number(batch.quantity);

          const availableQuantity = originalQuantity - soldQuantity;

          if (availableQuantity > 0) {
            totalAvailableQuantity += availableQuantity;
          }
        }

        return {
          sku: medicine.sku,
          medicineName: medicine.medicineName,
          brandName: medicine.brandName,
          composition: medicine.composition,
          category: medicine.category,
          hsnCode: medicine.hsnCode,
          hsnGstPercentage: medicine.hsnGstPercentage,
          form: medicine.form,
          shelf: medicine.shelf,
          reorder: medicine.reorder,
          packOf: medicine.packOf,
          availableQuantity: totalAvailableQuantity,
          status: medicine.status,
        };
      })
    );

    return medicinesWithAvailableQty;
  }

  static async generateMedicineSampleTemplate() {
    const workbook = new ExcelJS.Workbook();

    const templateSheet = workbook.addWorksheet('Medicine Upload');

    const hsnSheet = workbook.addWorksheet('HSN Master');

    const hsnCodes = await database
      .select({
        hsnCode: HsnTaxMasterModel.hsnCode,
      })
      .from(HsnTaxMasterModel);

    templateSheet.columns = [
      { header: 'Medicine Name *', key: 'medicineName', width: 35 },
      { header: 'HSN Code *', key: 'hsnCode', width: 20 },
      { header: 'Category (Optional)', key: 'category', width: 30 },
      { header: 'Brand Name (Optional)', key: 'brandName', width: 35 },
      { header: 'Composition (Optional)', key: 'composition', width: 35 },
      { header: 'Form (Optional)', key: 'form', width: 20 },
      { header: 'Shelf Location (Optional)', key: 'shelf', width: 35 },
      { header: 'Reorder Level (Optional)', key: 'reorder', width: 35 },
      { header: 'Pack Of (Optional)', key: 'packOf', width: 35 },
    ];

    templateSheet.getRow(1).font = {
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

    ['A1', 'B1'].forEach((cell) => {
      templateSheet.getCell(cell).fill = mandatoryHeaderFill;
      templateSheet.getCell(cell).border = headerBorder;
    });

    ['C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'].forEach((cell) => {
      templateSheet.getCell(cell).fill = optionalHeaderFill;
      templateSheet.getCell(cell).border = headerBorder;
    });

    templateSheet.getRow(1).alignment = {
      vertical: 'middle',
      horizontal: 'left',
    };

    templateSheet.views = [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ];

    templateSheet.getCell('A1').note =
      'Required. Medicine name must be unique.';

    templateSheet.getCell('B1').note =
      'Required. Select a valid HSN Code from dropdown.';

    templateSheet.getCell('C1').note = 'Optional. Enter category.';

    templateSheet.getCell('D1').note =
      'Optional. Enter brand name (max 50 chars).';

    templateSheet.getCell('E1').note =
      'Optional. Enter composition (max 200 chars).';

    templateSheet.getCell('F1').note = 'Optional. Enter medicine form.';

    templateSheet.getCell('G1').note = 'Optional. Enter shelf location.';

    templateSheet.getCell('H1').note = 'Optional. Numeric value only.';

    templateSheet.getCell('I1').note = 'Optional. Numeric value only.';

    hsnSheet.columns = [
      {
        header: 'HSN Code',
        key: 'hsnCode',
        width: 20,
      },
    ];

    hsnSheet.getRow(1).font = {
      bold: true,
    };

    hsnCodes.forEach((hsn) => {
      hsnSheet.addRow({
        hsnCode: hsn.hsnCode,
      });
    });

    // HSN dropdown
    const lastHsnRow = hsnCodes.length + 1;

    for (let row = 2; row <= 1000; row++) {
      templateSheet.getCell(`B${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'HSN Master'!$A$2:$A$${lastHsnRow}`],
        showErrorMessage: true,
        errorTitle: 'Invalid HSN Code',
        error: 'Please select a valid HSN Code from the dropdown.',
      };

      templateSheet.getCell(`H${row}`).dataValidation = {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        formulae: [0],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Reorder Level must be 0 or greater.',
      };
    }

    // Add 100 blank rows
    for (let i = 0; i < 100; i++) {
      templateSheet.addRow({
        medicineName: '',
        hsnCode: '',
        category: '',
        brandName: '',
        composition: '',
        form: '',
        shelf: '',
        reorder: '',
        packOf: '',
      });
    }

    hsnSheet.state = 'hidden';

    return workbook;
  }

  static async importMedicinesFromExcel(
    pharmacyId: string,
    fileBuffer: Buffer
  ) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new HttpError(400, 'Excel sheet not found');
    }

    const expectedHeaders = [
      'Medicine Name *',
      'HSN Code *',
      'Category (Optional)',
      'Brand Name (Optional)',
      'Composition (Optional)',
      'Form (Optional)',
      'Shelf Location (Optional)',
      'Reorder Level (Optional)',
      'Pack Of (Optional)',
    ];

    const headerRow = worksheet.getRow(1);

    const actualHeaders = expectedHeaders.map((_, index) =>
      String(headerRow.getCell(index + 1).value ?? '').trim()
    );

    const isValid = expectedHeaders.every(
      (header, index) => header === actualHeaders[index]
    );

    if (!isValid) {
      throw new HttpError(
        400,
        'Invalid template. Please use the downloaded medicine import template.'
      );
    }

    const insertedMedicines: string[] = [];
    const updatedMedicines: string[] = [];
    const skippedMedicines: string[] = [];
    const errors: string[] = [];

    const processedMedicines = new Set<string>();

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      const medicineName = String(row.getCell(1).value ?? '')
        .trim()
        .toUpperCase();
      const hsnCode = String(row.getCell(2).value ?? '').trim();
      const category = String(row.getCell(3).value ?? '').trim();
      const brandName = String(row.getCell(4).value ?? '').trim();
      const composition = String(row.getCell(5).value ?? '').trim();
      const form = String(row.getCell(6).value ?? '').trim();
      const shelf = String(row.getCell(7).value ?? '').trim();
      const reorderValue = String(row.getCell(8).value ?? '').trim();
      const packOfValue = String(row.getCell(9).value ?? '').trim();

      if (
        !medicineName &&
        !hsnCode &&
        !category &&
        !brandName &&
        !composition &&
        !form &&
        !shelf &&
        !reorderValue &&
        !packOfValue
      ) {
        continue;
      }

      if (!medicineName) {
        errors.push(`Row ${rowNumber}: Medicine Name is required`);
        continue;
      }

      if (!hsnCode) {
        errors.push(`Row ${rowNumber}: HSN Code is required`);
        continue;
      }

      const medicineKey = medicineName.toLowerCase().trim();

      if (processedMedicines.has(medicineKey)) {
        errors.push(
          `Row ${rowNumber}: Medicine "${medicineName}" is duplicated in the upload file`
        );
        continue;
      }

      processedMedicines.add(medicineKey);

      const [hsn] = await database
        .select({
          id: HsnTaxMasterModel.id,
          hsnCode: HsnTaxMasterModel.hsnCode,
        })
        .from(HsnTaxMasterModel)
        .where(eq(HsnTaxMasterModel.hsnCode, hsnCode))
        .limit(1);

      if (!hsn) {
        errors.push(`Row ${rowNumber}: Invalid HSN Code (${hsnCode})`);
        continue;
      }

      let reorder: number | null = null;

      if (reorderValue) {
        reorder = Number(reorderValue);

        if (!Number.isInteger(reorder) || reorder < 0) {
          errors.push(
            `Row ${rowNumber}: Reorder Level must be a positive whole number`
          );
          continue;
        }
      }

      let packOf: number | null = null;

      if (packOfValue) {
        packOf = Number(packOfValue);

        if (!Number.isInteger(packOf) || packOf < 1) {
          errors.push(
            `Row ${rowNumber}: Pack Of must be a positive whole number (1 or more)`
          );
          continue;
        }
      }

      if (medicineName.length > 200) {
        errors.push(`Row ${rowNumber}: Medicine Name too long`);
        continue;
      }

      if (category.length > 100) {
        errors.push(`Row ${rowNumber}: Category too long`);
        continue;
      }

      if (brandName.length > 50) {
        errors.push(`Row ${rowNumber}: Brand Name too long`);
        continue;
      }

      if (composition.length > 200) {
        errors.push(`Row ${rowNumber}: Composition too long`);
        continue;
      }

      if (form.length > 50) {
        errors.push(`Row ${rowNumber}: Form too long`);
        continue;
      }

      if (shelf.length > 100) {
        errors.push(`Row ${rowNumber}: Shelf Location too long`);
        continue;
      }

      const [existingMedicine] = await database
        .select()
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            sql`LOWER(${pharmacyMedicineModel.medicineName}) = LOWER(${medicineName})`
          )
        )
        .limit(1);

      const sku = this.generateSku(medicineName, form || null, hsn.hsnCode);

      const medicineValues = {
        medicineName,
        category: category || null,
        brandName: brandName || null,
        composition: composition || null,
        form: form || null,
        shelf: shelf || null,
        reorder,
        packOf,
        sku,
        hsnId: hsn.id,
        updatedAt: new Date(),
      };

      if (existingMedicine) {
        const [current] = await database
          .select()
          .from(pharmacyMedicineModel)
          .where(eq(pharmacyMedicineModel.id, existingMedicine.id))
          .limit(1);

        const hasChanges =
          current.medicineName !== medicineName ||
          (current.category ?? '') !== (category || '') ||
          (current.brandName ?? '') !== (brandName || '') ||
          (current.composition ?? '') !== (composition || '') ||
          (current.form ?? '') !== (form || '') ||
          (current.shelf ?? '') !== (shelf || '') ||
          (current.reorder ?? null) !== (reorder ?? null) ||
          (current.packOf ?? null) !== (packOf ?? null) ||
          (current.sku ?? '') !== sku ||
          (current.hsnId ?? '') !== hsn.id;

        if (!hasChanges) {
          skippedMedicines.push(
            `Row ${rowNumber}: ${medicineName} (No changes found)`
          );
          continue;
        }

        await database
          .update(pharmacyMedicineModel)
          .set(medicineValues)
          .where(eq(pharmacyMedicineModel.id, existingMedicine.id));

        updatedMedicines.push(`Row ${rowNumber}: ${medicineName}`);
        continue;
      }

      await database.insert(pharmacyMedicineModel).values({
        pharmacyId,
        ...medicineValues,
      });

      insertedMedicines.push(`Row ${rowNumber}: ${medicineName}`);
    }

    return {
      totalInserted: insertedMedicines.length,
      totalUpdated: updatedMedicines.length,
      totalSkipped: skippedMedicines.length,
      totalErrors: errors.length,

      insertedMedicines,
      updatedMedicines,
      skippedMedicines,
      errors,
    };
  }

  static async getMedicineStats(pharmacyId: string) {
    const now = new Date();

    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999
    );

    const percentageChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    const format = (data: any) => Number(data?.[0]?.count || 0);

    const [
      // ================= TOTAL MEDICINES (ALL TIME) =================
      totalMedicinesRes,
      currentMedicinesRes,
      previousMedicinesRes,

      // ================= CATEGORIES =================
      totalCategoriesRes,
      currentCategoriesRes,
      previousCategoriesRes,

      // ================= BRANDS =================
      totalBrandsRes,
      currentBrandsRes,
      previousBrandsRes,

      // ================= FORMS =================
      totalFormsRes,
      currentFormsRes,
      previousFormsRes,
    ] = await Promise.all([
      // TOTAL MEDICINES
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyMedicineModel)
        .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId)),

      // CURRENT MONTH MEDICINES ADDED
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, currentStart),
            lte(pharmacyMedicineModel.createdAt, currentEnd)
          )
        ),

      // PREVIOUS MONTH MEDICINES ADDED
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, previousStart),
            lte(pharmacyMedicineModel.createdAt, previousEnd)
          )
        ),

      // ================= TOTAL CATEGORIES =================
      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.category})`,
        })
        .from(pharmacyMedicineModel)
        .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId)),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.category})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, currentStart),
            lte(pharmacyMedicineModel.createdAt, currentEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.category})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, previousStart),
            lte(pharmacyMedicineModel.createdAt, previousEnd)
          )
        ),

      // ================= TOTAL BRANDS =================
      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.brandName})`,
        })
        .from(pharmacyMedicineModel)
        .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId)),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.brandName})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, currentStart),
            lte(pharmacyMedicineModel.createdAt, currentEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.brandName})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, previousStart),
            lte(pharmacyMedicineModel.createdAt, previousEnd)
          )
        ),

      // ================= TOTAL FORMS =================
      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.form})`,
        })
        .from(pharmacyMedicineModel)
        .where(eq(pharmacyMedicineModel.pharmacyId, pharmacyId)),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.form})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, currentStart),
            lte(pharmacyMedicineModel.createdAt, currentEnd)
          )
        ),

      database
        .select({
          count: sql<number>`COUNT(DISTINCT ${pharmacyMedicineModel.form})`,
        })
        .from(pharmacyMedicineModel)
        .where(
          and(
            eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
            gte(pharmacyMedicineModel.createdAt, previousStart),
            lte(pharmacyMedicineModel.createdAt, previousEnd)
          )
        ),
    ]);

    const totalMedicines = format(totalMedicinesRes);
    const currentMedicines = format(currentMedicinesRes);
    const previousMedicines = format(previousMedicinesRes);

    const totalCategories = format(totalCategoriesRes);
    const currentCategories = format(currentCategoriesRes);
    const previousCategories = format(previousCategoriesRes);

    const totalBrands = format(totalBrandsRes);
    const currentBrands = format(currentBrandsRes);
    const previousBrands = format(previousBrandsRes);

    const totalForms = format(totalFormsRes);
    const currentForms = format(currentFormsRes);
    const previousForms = format(previousFormsRes);

    return {
      totalMedicines: {
        value: totalMedicines,
        percentageChange: percentageChange(currentMedicines, previousMedicines),
        trend: currentMedicines >= previousMedicines ? 'increase' : 'decrease',
      },

      totalCategories: {
        value: totalCategories,
        percentageChange: percentageChange(
          currentCategories,
          previousCategories
        ),
        trend:
          currentCategories >= previousCategories ? 'increase' : 'decrease',
      },

      totalBrands: {
        value: totalBrands,
        percentageChange: percentageChange(currentBrands, previousBrands),
        trend: currentBrands >= previousBrands ? 'increase' : 'decrease',
      },

      totalForms: {
        value: totalForms,
        percentageChange: percentageChange(currentForms, previousForms),
        trend: currentForms >= previousForms ? 'increase' : 'decrease',
      },
    };
  }
}
