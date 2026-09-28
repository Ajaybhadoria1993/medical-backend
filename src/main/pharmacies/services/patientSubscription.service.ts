// patientSubscription.service.ts
import {
  and,
  eq,
  sql,
  or,
  between,
  gte,
  lte,
  asc,
  desc,
  inArray,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import {
  CreateSubscriptionInput,
  GetSubscriptionsNotificationQuery,
  GetSubscriptionsQuery,
  UpdateSubscriptionInput,
} from '../schemas/patientSubscription.schema';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import {
  pharmacyPatientSubscriptionModel,
  pharmacySubscriptionMedicineModel,
  pharmacySubscriptionSalesMapModel,
} from '../models/pharmacyPatientSubscription.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import { PharmacyStockService } from './stock.service';
import { PharmacySalesModel } from '../models/pharmacySales.model';

export class PatientSubscriptionService {
  static async createPatientSubscription(
    payload: CreateSubscriptionInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      // Verify pharmacy exists
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

      // Verify all medicines exist
      const medicineIds = payload.medicines.map((m) => m.pharmacyMedicineId);
      const existingMedicines = medicineIds.length
        ? await tx
            .select({ id: pharmacyMedicineModel.id })
            .from(pharmacyMedicineModel)
            .where(
              and(
                inArray(pharmacyMedicineModel.id, medicineIds),
                eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
                eq(pharmacyMedicineModel.status, 'active')
              )
            )
        : [];

      const existingMedicineSet = new Set(existingMedicines.map((m) => m.id));
      for (const item of payload.medicines) {
        if (!existingMedicineSet.has(item.pharmacyMedicineId)) {
          throw new HttpError(
            404,
            `Medicine with ID ${item.pharmacyMedicineId} not found`
          );
        }
      }

      // Create subscription
      const [subscription] = await tx
        .insert(pharmacyPatientSubscriptionModel)
        .values({
          pharmacyId,
          customerName: payload.customerName,
          customerMobile: payload.customerMobile,
          customerAddress: payload.customerAddress,
          frequencyDays: payload.frequencyDays,
          nextDeliveryDate: new Date(payload.nextDeliveryDate),
          status: 'active',
          remarks: payload.remarks,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      // Create subscription medicines in batch
      if (payload.medicines.length > 0) {
        await tx.insert(pharmacySubscriptionMedicineModel).values(
          payload.medicines.map((item) => ({
            pharmacyPatientSubscriptionId: subscription.id,
            pharmacyMedicineId: item.pharmacyMedicineId,
            quantity: item.quantity,
            createdAt: sql`NOW()`,
            updatedAt: sql`NOW()`,
          }))
        );
      }

      // Fetch created subscription with medicines
      const [createdSubscription] = await tx
        .select()
        .from(pharmacyPatientSubscriptionModel)
        .where(eq(pharmacyPatientSubscriptionModel.id, subscription.id))
        .limit(1);

      const medicines = await tx
        .select({
          id: pharmacySubscriptionMedicineModel.id,
          pharmacyMedicineId:
            pharmacySubscriptionMedicineModel.pharmacyMedicineId,
          quantity: pharmacySubscriptionMedicineModel.quantity,
          medicineName: pharmacyMedicineModel.medicineName,
          createdAt: pharmacySubscriptionMedicineModel.createdAt,
          updatedAt: pharmacySubscriptionMedicineModel.updatedAt,
        })
        .from(pharmacySubscriptionMedicineModel)
        .leftJoin(
          pharmacyMedicineModel,
          eq(
            pharmacySubscriptionMedicineModel.pharmacyMedicineId,
            pharmacyMedicineModel.id
          )
        )
        .where(
          eq(
            pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
            subscription.id
          )
        );

      return {
        ...createdSubscription,
        medicines,
      };
    });
  }

  static async updatePatientSubscription(
    subscriptionId: string,
    payload: UpdateSubscriptionInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      const [existingSubscription] = await tx
        .select()
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.id, subscriptionId),
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingSubscription) {
        throw new HttpError(404, 'Subscription not found');
      }

      const updateData: any = {
        updatedAt: sql`NOW()`,
      };

      if (payload.customerName !== undefined)
        updateData.customerName = payload.customerName;
      if (payload.customerMobile !== undefined)
        updateData.customerMobile = payload.customerMobile;
      if (payload.customerAddress !== undefined)
        updateData.customerAddress = payload.customerAddress;
      if (payload.frequencyDays !== undefined)
        updateData.frequencyDays = payload.frequencyDays;
      if (payload.nextDeliveryDate !== undefined)
        updateData.nextDeliveryDate = new Date(payload.nextDeliveryDate);
      if (payload.status !== undefined) updateData.status = payload.status;
      if (payload.remarks !== undefined) updateData.remarks = payload.remarks;

      await tx
        .update(pharmacyPatientSubscriptionModel)
        .set(updateData)
        .where(eq(pharmacyPatientSubscriptionModel.id, subscriptionId));

      // Update medicines if provided
      if (payload.medicines) {
        // Delete existing medicines
        await tx
          .delete(pharmacySubscriptionMedicineModel)
          .where(
            eq(
              pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
              subscriptionId
            )
          );

        // Verify all medicines exist
        const medicineIds = payload.medicines.map((m) => m.pharmacyMedicineId);
        const existingMedicines = medicineIds.length
          ? await tx
              .select({ id: pharmacyMedicineModel.id })
              .from(pharmacyMedicineModel)
              .where(
                and(
                  inArray(pharmacyMedicineModel.id, medicineIds),
                  eq(pharmacyMedicineModel.pharmacyId, pharmacyId),
                  eq(pharmacyMedicineModel.status, 'active')
                )
              )
          : [];

        const existingMedicineSet = new Set(existingMedicines.map((m) => m.id));
        for (const item of payload.medicines) {
          if (!existingMedicineSet.has(item.pharmacyMedicineId)) {
            throw new HttpError(
              404,
              `Medicine with ID ${item.pharmacyMedicineId} not found`
            );
          }
        }

        // Insert new medicines in batch
        if (payload.medicines.length > 0) {
          await tx.insert(pharmacySubscriptionMedicineModel).values(
            payload.medicines.map((item) => ({
              pharmacyPatientSubscriptionId: subscriptionId,
              pharmacyMedicineId: item.pharmacyMedicineId,
              quantity: item.quantity,
              createdAt: sql`NOW()`,
              updatedAt: sql`NOW()`,
            }))
          );
        }
      }

      // Fetch updated subscription with medicines
      const [updatedSubscription] = await tx
        .select()
        .from(pharmacyPatientSubscriptionModel)
        .where(eq(pharmacyPatientSubscriptionModel.id, subscriptionId))
        .limit(1);

      const medicines = await tx
        .select({
          id: pharmacySubscriptionMedicineModel.id,
          pharmacyMedicineId:
            pharmacySubscriptionMedicineModel.pharmacyMedicineId,
          quantity: pharmacySubscriptionMedicineModel.quantity,
          medicineName: pharmacyMedicineModel.medicineName,
          createdAt: pharmacySubscriptionMedicineModel.createdAt,
          updatedAt: pharmacySubscriptionMedicineModel.updatedAt,
        })
        .from(pharmacySubscriptionMedicineModel)
        .leftJoin(
          pharmacyMedicineModel,
          eq(
            pharmacySubscriptionMedicineModel.pharmacyMedicineId,
            pharmacyMedicineModel.id
          )
        )
        .where(
          eq(
            pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
            subscriptionId
          )
        );

      return {
        ...updatedSubscription,
        medicines,
      };
    });
  }

  static async getPatientSubscriptions(
    pharmacyId: string,
    query: GetSubscriptionsQuery
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

    // Build conditions
    const conditions: any[] = [
      eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
    ];

    if (query.status) {
      conditions.push(
        eq(pharmacyPatientSubscriptionModel.status, query.status)
      );
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      conditions.push(
        or(
          sql`${pharmacyPatientSubscriptionModel.customerName} ILIKE ${search}`,
          sql`CAST(${pharmacyPatientSubscriptionModel.customerMobile} AS TEXT) ILIKE ${search}`,
          sql`CAST(${pharmacyPatientSubscriptionModel.id} AS TEXT) ILIKE ${search}`
        )!
      );
    }

    if (query.startDate && query.endDate) {
      conditions.push(
        between(
          pharmacyPatientSubscriptionModel.nextDeliveryDate,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      conditions.push(
        sql`${pharmacyPatientSubscriptionModel.nextDeliveryDate} >= ${new Date(query.startDate)}`
      );
    } else if (query.endDate) {
      conditions.push(
        sql`${pharmacyPatientSubscriptionModel.nextDeliveryDate} <= ${new Date(query.endDate)}`
      );
    }

    // Get total count
    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(pharmacyPatientSubscriptionModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Get paginated subscriptions
    const subscriptions = await database
      .select({
        id: pharmacyPatientSubscriptionModel.id,
        pharmacyId: pharmacyPatientSubscriptionModel.pharmacyId,
        customerName: pharmacyPatientSubscriptionModel.customerName,
        customerMobile: pharmacyPatientSubscriptionModel.customerMobile,
        customerAddress: pharmacyPatientSubscriptionModel.customerAddress,
        frequencyDays: pharmacyPatientSubscriptionModel.frequencyDays,
        nextDeliveryDate: pharmacyPatientSubscriptionModel.nextDeliveryDate,
        status: pharmacyPatientSubscriptionModel.status,
        remarks: pharmacyPatientSubscriptionModel.remarks,
        createdAt: pharmacyPatientSubscriptionModel.createdAt,
        updatedAt: pharmacyPatientSubscriptionModel.updatedAt,
        salesAvailable: sql<boolean>`
          CASE 
            WHEN ${pharmacySubscriptionSalesMapModel.id} IS NOT NULL 
            THEN true 
            ELSE false 
          END
        `.as('salesAvailable'),
      })
      .from(pharmacyPatientSubscriptionModel)
      .leftJoin(
        pharmacySubscriptionSalesMapModel,
        eq(
          pharmacyPatientSubscriptionModel.id,
          pharmacySubscriptionSalesMapModel.pharmacyPatientSubscriptionId
        )
      )
      .where(and(...conditions))
      .orderBy(
        sql`case
              when ${pharmacyPatientSubscriptionModel.status} = 'active' then 0
              else 1
            end`,
        asc(pharmacyPatientSubscriptionModel.nextDeliveryDate)
      )
      .limit(limit)
      .offset(offset);

    // Fetch medicines for each subscription
    const subscriptionsWithMedicines = await Promise.all(
      subscriptions.map(async (subscription) => {
        const medicines = await database
          .select({
            id: pharmacySubscriptionMedicineModel.id,
            pharmacyMedicineId:
              pharmacySubscriptionMedicineModel.pharmacyMedicineId,
            quantity: pharmacySubscriptionMedicineModel.quantity,
            medicineName: pharmacyMedicineModel.medicineName,
            brand: pharmacyMedicineModel.brandName,
            sku: pharmacyMedicineModel.sku,
            category: pharmacyMedicineModel.category,
            form: pharmacyMedicineModel.form,
            createdAt: pharmacySubscriptionMedicineModel.createdAt,
            updatedAt: pharmacySubscriptionMedicineModel.updatedAt,
          })
          .from(pharmacySubscriptionMedicineModel)
          .leftJoin(
            pharmacyMedicineModel,
            eq(
              pharmacySubscriptionMedicineModel.pharmacyMedicineId,
              pharmacyMedicineModel.id
            )
          )
          .where(
            eq(
              pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
              subscription.id
            )
          );

        return {
          ...subscription,
          medicines,
        };
      })
    );

    return {
      subscriptions: subscriptionsWithMedicines,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getPatientSubscriptionById(
    subscriptionId: string,
    pharmacyId: string
  ) {
    const subscriptionResult = await database
      .select()
      .from(pharmacyPatientSubscriptionModel)
      .where(
        and(
          eq(pharmacyPatientSubscriptionModel.id, subscriptionId),
          eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    const subscription = subscriptionResult[0];

    if (!subscription) {
      throw new HttpError(404, 'Subscription not found');
    }

    // Get subscription medicines with tags in a single query
    const medicines = await database
      .select({
        id: pharmacySubscriptionMedicineModel.id,
        quantity: pharmacySubscriptionMedicineModel.quantity,
        pharmacyMedicineId:
          pharmacySubscriptionMedicineModel.pharmacyMedicineId,

        medicineId: pharmacyMedicineModel.id,
        medicineName: pharmacyMedicineModel.medicineName,
        brandName: pharmacyMedicineModel.brandName,
        composition: pharmacyMedicineModel.composition,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,
        shelf: pharmacyMedicineModel.shelf,
        sku: pharmacyMedicineModel.sku,
        packOf: pharmacyMedicineModel.packOf,
        tags: sql<string[]>`COALESCE(
          (
            SELECT array_agg(DISTINCT ${PharmacyMedicineTagsModel.tag})
            FROM ${PharmacyTagsMapModel}
            INNER JOIN ${PharmacyMedicineTagsModel} 
              ON ${PharmacyTagsMapModel.tagId} = ${PharmacyMedicineTagsModel.id}
            WHERE ${PharmacyTagsMapModel.medicineId} = ${pharmacyMedicineModel.id}
          ),
          ARRAY[]::varchar[]
        )`,
      })
      .from(pharmacySubscriptionMedicineModel)
      .innerJoin(
        pharmacyMedicineModel,
        eq(
          pharmacySubscriptionMedicineModel.pharmacyMedicineId,
          pharmacyMedicineModel.id
        )
      )
      .where(
        eq(
          pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
          subscriptionId
        )
      );

    // Get all available stock for this pharmacy (using the service)
    const stockResult = await PharmacyStockService.getAvailableStock(
      pharmacyId,
      {
        pageNumber: 1,
        pageSize: 100,
      }
    );

    const stockMedicines = stockResult.stocks;

    // Map subscription medicines with stock data
    const medicinesWithStock = medicines.map((medicine) => {
      // Find matching stock from available stocks
      let matchingStock = null;

      for (const stock of stockMedicines) {
        if (stock.id === medicine.medicineId) {
          matchingStock = stock;
          break;
        }
      }

      // If matching stock found, use its data; otherwise use medicine data with empty batches
      if (matchingStock) {
        return {
          // Subscription medicine details
          id: medicine.id,
          quantity: medicine.quantity,
          pharmacyMedicineId: medicine.pharmacyMedicineId,

          // Medicine details (from stock)
          medicineId: matchingStock.id,
          medicineName: matchingStock.medicineName,
          brandName: matchingStock.brandName,
          composition: matchingStock.composition,
          category: matchingStock.category,
          form: matchingStock.form,
          shelf: matchingStock.shelf,
          packOf: matchingStock.packOf,
          tags: matchingStock.tags || medicine.tags || [],

          // Availability and batches (from stock)
          availableQuantity: matchingStock.availableQuantity || 0,
          defaultBatchId: matchingStock.medicineAvailable?.[0]?.id || null,
          availableBatches: matchingStock.medicineAvailable || [],
        };
      } else {
        // Medicine not found in stock - return with empty batches
        return {
          id: medicine.id,
          quantity: medicine.quantity,
          pharmacyMedicineId: medicine.pharmacyMedicineId,

          medicineId: medicine.medicineId,
          medicineName: medicine.medicineName,
          brandName: medicine.brandName,
          composition: medicine.composition,
          category: medicine.category,
          form: medicine.form,
          shelf: medicine.shelf,
          packOf: medicine.packOf,
          tags: medicine.tags || [],

          availableQuantity: 0,
          defaultBatchId: null,
          availableBatches: [],
        };
      }
    });

    return {
      ...subscription,
      medicines: medicinesWithStock,
    };
  }

  static async getSubscriptionSales(
    pharmacyId: string,
    subscriptionId: string,
    query: GetSubscriptionsNotificationQuery
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
      eq(PharmacySalesModel.pharmacyId, pharmacyId),
      eq(
        pharmacySubscriptionSalesMapModel.pharmacyPatientSubscriptionId,
        subscriptionId
      ),
    ];

    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(pharmacySubscriptionSalesMapModel)
      .innerJoin(
        PharmacySalesModel,
        eq(
          pharmacySubscriptionSalesMapModel.pharmacySalesId,
          PharmacySalesModel.id
        )
      )
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const sales = await database
      .select({
        subscriptionId:
          pharmacySubscriptionSalesMapModel.pharmacyPatientSubscriptionId,
        salesId: PharmacySalesModel.id,
        units: PharmacySalesModel.totalItems,
        totalAmount: PharmacySalesModel.totalAmount,
        createdAt: PharmacySalesModel.createdAt,
      })
      .from(pharmacySubscriptionSalesMapModel)
      .innerJoin(
        PharmacySalesModel,
        eq(
          pharmacySubscriptionSalesMapModel.pharmacySalesId,
          PharmacySalesModel.id
        )
      )
      .where(and(...conditions))
      .orderBy(desc(PharmacySalesModel.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      sales,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getPatientSubscriptionsNotification(
    pharmacyId: string,
    query: GetSubscriptionsNotificationQuery
  ) {
    // Verify pharmacy exists
    const [pharmacy] = await database
      .select({
        id: PharmacyModel.id,
        subscriptionNotificationReadDate:
          PharmacyModel.subscriptionNotificationReadDate,
      })
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

    if (pharmacy.subscriptionNotificationReadDate) {
      const readDate = new Date(pharmacy.subscriptionNotificationReadDate);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const readDay = new Date(readDate);
      readDay.setUTCHours(0, 0, 0, 0);

      if (readDay.getTime() === today.getTime()) {
        return {
          subscriptions: [],
          pagination: {
            totalRecords: 0,
            totalPages: 0,
            currentPage: 1,
            pageSize: Number(query.pageSize) || 30,
          },
        };
      }
    }

    const pageSize = Math.max(Number(query.pageSize) || 30, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    // Build conditions
    const conditions: any[] = [
      and(
        eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
        eq(pharmacyPatientSubscriptionModel.status, 'active')
      ),
    ];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(23, 59, 59, 999);

    conditions.push(
      between(
        pharmacyPatientSubscriptionModel.nextDeliveryDate,
        today,
        tomorrow
      )
    );

    // Get total count
    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(pharmacyPatientSubscriptionModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Get paginated subscriptions
    const subscriptions = await database
      .select({
        id: pharmacyPatientSubscriptionModel.id,
        pharmacyId: pharmacyPatientSubscriptionModel.pharmacyId,
        customerName: pharmacyPatientSubscriptionModel.customerName,
        customerMobile: pharmacyPatientSubscriptionModel.customerMobile,
        customerAddress: pharmacyPatientSubscriptionModel.customerAddress,
        frequencyDays: pharmacyPatientSubscriptionModel.frequencyDays,
        nextDeliveryDate: pharmacyPatientSubscriptionModel.nextDeliveryDate,
        status: pharmacyPatientSubscriptionModel.status,
        remarks: pharmacyPatientSubscriptionModel.remarks,
        createdAt: pharmacyPatientSubscriptionModel.createdAt,
        updatedAt: pharmacyPatientSubscriptionModel.updatedAt,
      })
      .from(pharmacyPatientSubscriptionModel)
      .where(and(...conditions))
      .orderBy(asc(pharmacyPatientSubscriptionModel.nextDeliveryDate))
      .limit(limit)
      .offset(offset);

    // Fetch medicines for each subscription
    const subscriptionsWithMedicines = await Promise.all(
      subscriptions.map(async (subscription) => {
        const medicines = await database
          .select({
            id: pharmacySubscriptionMedicineModel.id,
            pharmacyMedicineId:
              pharmacySubscriptionMedicineModel.pharmacyMedicineId,
            quantity: pharmacySubscriptionMedicineModel.quantity,
            medicineName: pharmacyMedicineModel.medicineName,
            brand: pharmacyMedicineModel.brandName,
            sku: pharmacyMedicineModel.sku,
            category: pharmacyMedicineModel.category,
            form: pharmacyMedicineModel.form,
            createdAt: pharmacySubscriptionMedicineModel.createdAt,
            updatedAt: pharmacySubscriptionMedicineModel.updatedAt,
          })
          .from(pharmacySubscriptionMedicineModel)
          .leftJoin(
            pharmacyMedicineModel,
            eq(
              pharmacySubscriptionMedicineModel.pharmacyMedicineId,
              pharmacyMedicineModel.id
            )
          )
          .where(
            eq(
              pharmacySubscriptionMedicineModel.pharmacyPatientSubscriptionId,
              subscription.id
            )
          );

        return {
          ...subscription,
          medicines,
        };
      })
    );

    return {
      subscriptions: subscriptionsWithMedicines,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async markSubscriptionNotificationRead(pharmacyId: string) {
    const [pharmacy] = await database
      .select({
        id: PharmacyModel.id,
      })
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

    const today = new Date();

    today.setUTCHours(0, 0, 0, 0);

    const [updatedPharmacy] = await database
      .update(PharmacyModel)
      .set({
        subscriptionNotificationReadDate: today,
        updatedAt: new Date(),
      })
      .where(eq(PharmacyModel.id, pharmacyId))
      .returning({
        id: PharmacyModel.id,
        subscriptionNotificationReadDate:
          PharmacyModel.subscriptionNotificationReadDate,
      });

    return updatedPharmacy;
  }

  static async updateNextDeliveryDate(
    subscriptionId: string,
    nextDeliveryDate: string,
    pharmacyId: string
  ) {
    const [existingSubscription] = await database
      .select()
      .from(pharmacyPatientSubscriptionModel)
      .where(
        and(
          eq(pharmacyPatientSubscriptionModel.id, subscriptionId),
          eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!existingSubscription) {
      throw new HttpError(404, 'Subscription not found');
    }

    const [updated] = await database
      .update(pharmacyPatientSubscriptionModel)
      .set({
        nextDeliveryDate: new Date(nextDeliveryDate),
        updatedAt: sql`NOW()`,
      })
      .where(eq(pharmacyPatientSubscriptionModel.id, subscriptionId))
      .returning();

    return updated;
  }

  static async getPatientSubscriptionStats(pharmacyId: string) {
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
      totalSubscriptionsRes,
      currentSubscriptionsRes,
      previousSubscriptionsRes,

      totalActiveRes,
      currentActiveRes,
      previousActiveRes,

      totalInactiveRes,
      currentInactiveRes,
      previousInactiveRes,

      totalPausedRes,
      currentPausedRes,
      previousPausedRes,
    ] = await Promise.all([
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId)),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            gte(pharmacyPatientSubscriptionModel.createdAt, currentStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, currentEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            gte(pharmacyPatientSubscriptionModel.createdAt, previousStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, previousEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'active')
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'active'),
            gte(pharmacyPatientSubscriptionModel.createdAt, currentStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, currentEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'active'),
            gte(pharmacyPatientSubscriptionModel.createdAt, previousStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, previousEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'cancelled')
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'cancelled'),
            gte(pharmacyPatientSubscriptionModel.createdAt, currentStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, currentEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'cancelled'),
            gte(pharmacyPatientSubscriptionModel.createdAt, previousStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, previousEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'paused')
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'paused'),
            gte(pharmacyPatientSubscriptionModel.createdAt, currentStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, currentEnd)
          )
        ),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(pharmacyPatientSubscriptionModel)
        .where(
          and(
            eq(pharmacyPatientSubscriptionModel.pharmacyId, pharmacyId),
            eq(pharmacyPatientSubscriptionModel.status, 'paused'),
            gte(pharmacyPatientSubscriptionModel.createdAt, previousStart),
            lte(pharmacyPatientSubscriptionModel.createdAt, previousEnd)
          )
        ),
    ]);

    const totalSubscriptions = format(totalSubscriptionsRes);
    const currentSubscriptions = format(currentSubscriptionsRes);
    const previousSubscriptions = format(previousSubscriptionsRes);

    const totalActive = format(totalActiveRes);
    const currentActive = format(currentActiveRes);
    const previousActive = format(previousActiveRes);

    const totalInactive = format(totalInactiveRes);
    const currentInactive = format(currentInactiveRes);
    const previousInactive = format(previousInactiveRes);

    const totalPaused = format(totalPausedRes);
    const currentPaused = format(currentPausedRes);
    const previousPaused = format(previousPausedRes);

    return {
      totalSubscriptions: {
        value: totalSubscriptions,
        percentageChange: percentageChange(
          currentSubscriptions,
          previousSubscriptions
        ),
        trend:
          currentSubscriptions >= previousSubscriptions
            ? 'increase'
            : 'decrease',
      },

      activeSubscriptions: {
        value: totalActive,
        percentageFromTotal:
          totalSubscriptions === 0
            ? 0
            : Number(((totalActive / totalSubscriptions) * 100).toFixed(2)),
        percentageChange: percentageChange(currentActive, previousActive),
        trend: currentActive >= previousActive ? 'increase' : 'decrease',
      },

      inactiveSubscriptions: {
        value: totalInactive,
        percentageFromTotal:
          totalSubscriptions === 0
            ? 0
            : Number(((totalInactive / totalSubscriptions) * 100).toFixed(2)),
        percentageChange: percentageChange(currentInactive, previousInactive),
        trend: currentInactive >= previousInactive ? 'increase' : 'decrease',
      },

      pausedSubscriptions: {
        value: totalPaused,
        percentageFromTotal:
          totalSubscriptions === 0
            ? 0
            : Number(((totalPaused / totalSubscriptions) * 100).toFixed(2)),
        percentageChange: percentageChange(currentPaused, previousPaused),
        trend: currentPaused >= previousPaused ? 'increase' : 'decrease',
      },
    };
  }
}
