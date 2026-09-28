import { and, eq, sql, desc, between, gte, or, lt, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { notificationsEnabled } from '../../../utils/envConfig';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { pagination } from '../../../utils/utils';
import { CreateSaleInput } from '../schemas/sales.schema';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { PharmacySalesModel } from '../models/pharmacySales.model';
import { PharmacySalesItemsModel } from '../models/pharmacySalesItems.model';
import {
  PharmacySalesReturnItemsModel,
  PharmacySalesReturnModel,
} from '../models/pharmacySalesReturn.model';
import { PharmacyStockMedicineModel } from '../models/pharmacyStockMedicine.model';
import { pharmacyMedicineModel } from '../models/pharmacyMedicine.model';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { PrescriptionQueueModel } from '../../pharmacy/models/prescriptionQueue.model';
import { PharmacyStockModel } from '../models/pharmacyStock.model';
import { pharmacySaleInvoiceTemplate } from '../../../htmltamplates/pharmacySaleInvoice';
import { generateAndUploadSaleInvoicePdf } from '../../../utils/invoice-pdf.service';
import { enqueueWhatsAppTemplate } from '../../notifications/queues/whatsappOutbox.queue';
import {
  doesFileExistInS3,
  s3ObjectUrl,
  withEnvPrefix,
} from '../../../configurations/s3/client';
import { pharmacySubscriptionSalesMapModel } from '../models/pharmacyPatientSubscription.model';
import {
  PharmacyMedicineTagsModel,
  PharmacyTagsMapModel,
} from '../models/pharmacyMedicineTags.model';
import { PharmacyStockService } from './stock.service';

export class PharmacySalesService {
  static async createSale(
    payload: CreateSaleInput,
    pharmacyId: string,
    userId: string
  ) {
    const affectedMedicineIds = new Set<string>();

    const result = await database.transaction(async (tx) => {
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

      if (payload.prescriptionId) {
        const [prescription] = await tx
          .select({
            id: PrescriptionQueueModel.id,
            status: PrescriptionQueueModel.status,
          })
          .from(PrescriptionQueueModel)
          .where(eq(PrescriptionQueueModel.id, payload.prescriptionId))
          .limit(1);

        if (!prescription) {
          throw new HttpError(404, 'Prescription not found');
        }

        if (
          prescription.status !== 'PENDING' &&
          prescription.status !== 'ON_HOLD'
        ) {
          throw new HttpError(
            400,
            'Sale can only be created for pending and on hold prescriptions'
          );
        }
      }

      let subtotal = 0;
      let totalDiscount = 0;
      let totalItems = 0;
      let totalGstAmount = 0;

      // Batch-fetch batch/medicine/HSN details for all requested batches in one query
      const stockMedicineIds = payload.items.map(
        (item) => item.pharmacyStockMedicineId
      );

      const batchRows = await tx
        .select({
          id: PharmacyStockMedicineModel.id,
          pharmacyStockId: PharmacyStockMedicineModel.pharmacyStockId,
          pharmacyMedicineId: PharmacyStockMedicineModel.pharmacyMedicineId,
          quantity: PharmacyStockMedicineModel.quantity,
          mrp: PharmacyStockMedicineModel.mrp,
          cost: PharmacyStockMedicineModel.cost,
          batch: PharmacyStockMedicineModel.batch,
          expiry: PharmacyStockMedicineModel.expiry,
          medicineName: pharmacyMedicineModel.medicineName,
          packOf: pharmacyMedicineModel.packOf,
          hsnId: pharmacyMedicineModel.hsnId,
          hsnCode: HsnTaxMasterModel.hsnCode,
          gstPercentage: HsnTaxMasterModel.gstPercentage,
        })
        .from(PharmacyStockMedicineModel)
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
            inArray(PharmacyStockMedicineModel.id, stockMedicineIds),
            gte(PharmacyStockMedicineModel.quantity, 1)
          )
        )
        .for('update', { of: PharmacyStockMedicineModel });

      const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));

      const medicineIds = [
        ...new Set(batchRows.map((batch) => batch.pharmacyMedicineId)),
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

      const saleItems: {
        batchId: string;
        quantity: number;
        discountPercent: number;
        total: number;
        gstAmount: number;
        gstPercentage: number;
        batchDetails: (typeof batchRows)[number];
      }[] = [];

      // Batch-fetch already-sold quantities for all requested batches in one query
      const soldRows = await tx
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
            stockMedicineIds
          )
        )
        .groupBy(PharmacySalesItemsModel.pharmacyStockMedicineId);

      const soldById = new Map(
        soldRows.map((row) => [
          row.pharmacyStockMedicineId,
          Number(row.totalSold) || 0,
        ])
      );

      // Tracks quantity already claimed by earlier items in this same request,
      // in case the same batch is requested more than once in one sale.
      const reservedInThisSale = new Map<string, number>();

      // Process each sale item - Calculate GST based on HSN
      for (const item of payload.items) {
        const batch = batchById.get(item.pharmacyStockMedicineId);

        if (!batch) {
          throw new HttpError(
            404,
            `Batch with ID ${item.pharmacyStockMedicineId} not found`
          );
        }

        affectedMedicineIds.add(batch.pharmacyMedicineId);

        const medicineTags =
          tagsByMedicineId.get(batch.pharmacyMedicineId) || [];
        const hasFullstripTag = medicineTags.some(
          (t) =>
            t && t.trim().toLowerCase().replace(/[\s_]/g, '') === 'fullstrip'
        );
        const packOf = Number(batch.packOf);

        if (hasFullstripTag && packOf > 1) {
          if (item.quantity % packOf !== 0) {
            throw new HttpError(
              400,
              `Sale quantity for "${batch.medicineName}" (Batch: ${batch.batch}) must be in full pack quantities of ${packOf}`
            );
          }
        }

        if (batch.expiry && new Date(batch.expiry) < new Date()) {
          throw new HttpError(
            400,
            `Cannot sell medicine "${batch.medicineName}" (Batch: ${batch.batch}) because it has expired on ${new Date(batch.expiry).toLocaleDateString()}`
          );
        }

        // Calculate available quantity
        const originalQuantity = Number(batch.quantity);
        const soldQuantity = soldById.get(item.pharmacyStockMedicineId) || 0;
        const alreadyReserved =
          reservedInThisSale.get(item.pharmacyStockMedicineId) || 0;
        const availableQuantity =
          originalQuantity - soldQuantity - alreadyReserved;

        if (availableQuantity < item.quantity) {
          throw new HttpError(
            400,
            `Insufficient stock for medicine "${batch.medicineName}" (Batch: ${batch.batch}). Available: ${availableQuantity}, Requested: ${item.quantity}`
          );
        }

        reservedInThisSale.set(
          item.pharmacyStockMedicineId,
          alreadyReserved + item.quantity
        );

        const itemMrp = Number(batch.mrp);
        const itemTotal = itemMrp * item.quantity;
        const discount = (itemTotal * item.discountPercent) / 100;
        const itemFinalTotal = itemTotal - discount;

        // Calculate GST for this item
        const gstPercentage = Number(batch.gstPercentage) || 0;
        const itemGstAmount = (itemFinalTotal * gstPercentage) / 100;

        subtotal += itemTotal;
        totalDiscount += discount;
        totalGstAmount += itemGstAmount;
        totalItems += 1;

        saleItems.push({
          batchId: batch.id,
          quantity: item.quantity,
          discountPercent: item.discountPercent,
          total: itemFinalTotal,
          gstAmount: itemGstAmount,
          gstPercentage: gstPercentage,
          batchDetails: batch,
        });
      }

      // Calculate final total (subtotal - discount + GST)
      const finalTotal = subtotal - totalDiscount + totalGstAmount;

      // Create sales record
      const [sale] = await tx
        .insert(PharmacySalesModel)
        .values({
          pharmacyId: pharmacyId,
          createdBy: userId,
          prescriptionId: payload.prescriptionId,
          patientName: payload.patientName,
          patientMobile: payload.patientMobile,
          paymentMethod: payload.paymentMethod,
          paymentNotes: payload.paymentNotes,
          totalItems: totalItems,
          subtotal: subtotal.toString(),
          gstAmount: totalGstAmount.toString(),
          discountAmount: totalDiscount.toString(),
          totalAmount: finalTotal.toString(),
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      // Create sales items in a single batched insert
      await tx.insert(PharmacySalesItemsModel).values(
        payload.items.map((item, i) => ({
          pharmacySalesId: sale.id,
          pharmacyStockMedicineId: item.pharmacyStockMedicineId,
          quantity: item.quantity,
          discountPercent: item.discountPercent.toString(),
          total: saleItems[i].total.toString(),
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        }))
      );

      if (payload.subscriptionId) {
        await tx.insert(pharmacySubscriptionSalesMapModel).values({
          pharmacyPatientSubscriptionId: payload.subscriptionId,
          pharmacySalesId: sale.id,
        });
      }

      return sale;
    });

    await PharmacyStockService.refreshStockCacheMedicinesSafely(pharmacyId, [
      ...affectedMedicineIds,
    ]);

    return result;
  }

  static async getSales(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      startDate?: string;
      endDate?: string;
      search?: string;
      paymentMethod?: string;
      prescriptionId?: string;
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

    // Build conditions
    const conditions: any[] = [eq(PharmacySalesModel.pharmacyId, pharmacyId)];

    if (query.paymentMethod) {
      conditions.push(
        eq(PharmacySalesModel.paymentMethod, query.paymentMethod)
      );
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;

      conditions.push(
        or(
          sql`${PharmacySalesModel.patientName} ILIKE ${search}`,
          sql`CAST(${PharmacySalesModel.patientMobile} AS TEXT) ILIKE ${search}`,
          sql`CAST(${PharmacySalesModel.id} AS TEXT) ILIKE ${search}`
        )!
      );
    }

    if (query.prescriptionId) {
      conditions.push(
        eq(PharmacySalesModel.prescriptionId, query.prescriptionId)
      );
    }

    if (query.startDate && query.endDate) {
      conditions.push(
        between(
          PharmacySalesModel.createdAt,
          new Date(query.startDate),
          new Date(query.endDate)
        )
      );
    } else if (query.startDate) {
      conditions.push(
        sql`${PharmacySalesModel.createdAt} >= ${new Date(query.startDate)}`
      );
    } else if (query.endDate) {
      conditions.push(
        sql`${PharmacySalesModel.createdAt} <= ${new Date(query.endDate)}`
      );
    }

    // Get total count
    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(PharmacySalesModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Get paginated sales
    const sales = await database
      .select({
        id: PharmacySalesModel.id,
        pharmacyId: PharmacySalesModel.pharmacyId,
        createdBy: PharmacySalesModel.createdBy,
        prescriptionId: PharmacySalesModel.prescriptionId,
        patientName: PharmacySalesModel.patientName,
        patientMobile: PharmacySalesModel.patientMobile,
        paymentMethod: PharmacySalesModel.paymentMethod,
        paymentNotes: PharmacySalesModel.paymentNotes,
        totalItems: PharmacySalesModel.totalItems,
        subtotal: PharmacySalesModel.subtotal,
        gstAmount: PharmacySalesModel.gstAmount,
        discountAmount: PharmacySalesModel.discountAmount,
        totalAmount: PharmacySalesModel.totalAmount,
        createdAt: PharmacySalesModel.createdAt,
        updatedAt: PharmacySalesModel.updatedAt,
      })
      .from(PharmacySalesModel)
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

  static async getSaleById(id: string, pharmacyId: string) {
    const [sale] = await database
      .select({
        id: PharmacySalesModel.id,
        pharmacyId: PharmacySalesModel.pharmacyId,
        pharmacyName: PharmacyModel.name,
        pharmacyAddress: PharmacyModel.address,
        pharmacyContactNumber: PharmacyModel.contactNumber,
        gstNumber: PharmacyModel.gstNumber,
        createdBy: PharmacySalesModel.createdBy,
        prescriptionId: PharmacySalesModel.prescriptionId,
        patientName: PharmacySalesModel.patientName,
        patientMobile: PharmacySalesModel.patientMobile,
        paymentMethod: PharmacySalesModel.paymentMethod,
        paymentNotes: PharmacySalesModel.paymentNotes,
        totalItems: PharmacySalesModel.totalItems,
        subtotal: PharmacySalesModel.subtotal,
        gstAmount: PharmacySalesModel.gstAmount,
        discountAmount: PharmacySalesModel.discountAmount,
        totalAmount: PharmacySalesModel.totalAmount,
        createdAt: PharmacySalesModel.createdAt,
        updatedAt: PharmacySalesModel.updatedAt,
      })
      .from(PharmacySalesModel)
      .leftJoin(
        PharmacyModel,
        eq(PharmacySalesModel.pharmacyId, PharmacyModel.id)
      )
      .where(
        and(
          or(
            eq(PharmacySalesModel.id, id),
            eq(PharmacySalesModel.prescriptionId, id)
          ),
          eq(PharmacySalesModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!sale) {
      throw new HttpError(404, 'Sale not found');
    }

    // Get sale items with batch, medicine, and HSN details
    const items = await database
      .select({
        id: PharmacySalesItemsModel.id,
        pharmacySalesId: PharmacySalesItemsModel.pharmacySalesId,
        pharmacyStockMedicineId:
          PharmacySalesItemsModel.pharmacyStockMedicineId,
        quantity: PharmacySalesItemsModel.quantity,
        discountPercent: PharmacySalesItemsModel.discountPercent,
        total: PharmacySalesItemsModel.total,
        createdAt: PharmacySalesItemsModel.createdAt,
        batch: PharmacyStockMedicineModel.batch,
        expiry: PharmacyStockMedicineModel.expiry,
        mrp: PharmacyStockMedicineModel.mrp,
        cost: PharmacyStockMedicineModel.cost,
        medicineName: pharmacyMedicineModel.medicineName,
        category: pharmacyMedicineModel.category,
        form: pharmacyMedicineModel.form,
        hsnCode: HsnTaxMasterModel.hsnCode,
        gstPercentage: HsnTaxMasterModel.gstPercentage,
      })
      .from(PharmacySalesItemsModel)
      .leftJoin(
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
      .where(eq(PharmacySalesItemsModel.pharmacySalesId, sale.id));

    // Calculate GST breakdown per item
    const itemsWithGst = items.map((item) => {
      const itemTotal = Number(item.total);
      const gstPercentage = Number(item.gstPercentage) || 0;
      const cgst = gstPercentage / 2;
      const sgst = gstPercentage / 2;
      const itemGstAmount = (itemTotal * gstPercentage) / 100;

      return {
        ...item,
        gstBreakdown: {
          gstPercentage,
          cgst,
          sgst,
          gstAmount: itemGstAmount,
        },
      };
    });

    return {
      ...sale,
      items: itemsWithGst,
    };
  }

  // Helper API to check available stock for a batch
  static async getBatchAvailableQuantity(batchId: string, pharmacyId: string) {
    const [batch] = await database
      .select({
        id: PharmacyStockMedicineModel.id,
        pharmacyId: PharmacyStockModel.pharmacyId,
        batch: PharmacyStockMedicineModel.batch,
        quantity: PharmacyStockMedicineModel.quantity,
        medicineName: pharmacyMedicineModel.medicineName,
        mrp: PharmacyStockMedicineModel.mrp,
        gstPercentage: HsnTaxMasterModel.gstPercentage,
      })
      .from(PharmacyStockMedicineModel)
      .leftJoin(
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
      .leftJoin(
        HsnTaxMasterModel,
        eq(pharmacyMedicineModel.hsnId, HsnTaxMasterModel.id)
      )
      .where(
        and(
          eq(PharmacyStockMedicineModel.id, batchId),
          eq(PharmacyStockModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!batch) {
      throw new HttpError(404, 'Batch not found');
    }

    const originalQuantity = Number(batch.quantity);

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
      .where(eq(PharmacySalesItemsModel.pharmacyStockMedicineId, batchId));

    const soldQuantity = Number(soldResult[0]?.totalSold) || 0;
    const availableQuantity = originalQuantity - soldQuantity;

    return {
      batchId: batch.id,
      batchNumber: batch.batch,
      medicineName: batch.medicineName,
      mrp: Number(batch.mrp),
      gstPercentage: Number(batch.gstPercentage),
      originalQuantity,
      soldQuantity,
      availableQuantity,
    };
  }

  // Helper function to format currency
  private static formatCurrency(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(num);
  }

  // Helper function to format date
  private static formatDate(dateString: string | Date): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  // Helper function to format time
  private static formatTime(dateString: string | Date): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Generate invoice PDF and send via WhatsApp
  static async sendInvoiceViaWhatsApp(saleId: string, pharmacyId: string) {
    // Get sale with all details
    const saleData = await this.getSaleById(saleId, pharmacyId);

    if (!saleData) {
      throw new HttpError(404, 'Sale not found');
    }

    if (!saleData.patientMobile) {
      throw new HttpError(400, 'Patient mobile number not found');
    }

    const [pharmacy] = await database
      .select({
        id: PharmacyModel.id,
        name: PharmacyModel.name,
        address: PharmacyModel.address,
        contactNumber: PharmacyModel.contactNumber,
        clinicId: PharmacyModel.clinicId,
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

    // Invoices used to send regardless of the owning clinic's WhatsApp opt-out,
    // unlike every other WhatsApp trigger. Checked before the PDF is generated
    // so a disabled clinic doesn't pay for an S3 upload it can't use. This is an
    // explicit staff action, so it fails loudly rather than skipping silently.
    if (!notificationsEnabled()) {
      throw new HttpError(
        503,
        'Notifications are disabled on this environment'
      );
    }

    const [clinicSettings] = await database
      .select({ whatsappEnabled: ClinicSettingsModel.whatsappEnabled })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, pharmacy.clinicId))
      .limit(1);

    if (!clinicSettings?.whatsappEnabled) {
      throw new HttpError(
        400,
        'WhatsApp is disabled for this clinic. Enable it in clinic settings to send invoices.'
      );
    }

    // Prepare invoice data for PDF generation
    // Calculate item totals: (MRP * Qty * (1 - discount%/100)) + (MRP * Qty * (1 - discount%/100) * (GST%/100))
    const medicines = saleData.items.map((item: any) => {
      const mrp = Number(item.mrp);
      const quantity = Number(item.quantity);
      const discountPercent = Number(item.discountPercent) || 0;
      const gstPercentage = Number(item.gstPercentage) || 0;

      // Amount before discount
      const amountBeforeDiscount = mrp * quantity;

      // Amount after discount
      const amountAfterDiscount =
        amountBeforeDiscount * (1 - discountPercent / 100);

      // GST amount
      const gstAmount = amountAfterDiscount * (gstPercentage / 100);

      // Total = Amount After Discount + GST
      const total = amountAfterDiscount + gstAmount;

      return {
        medicineName: item.medicineName || '',
        quantity: quantity,
        mrp: this.formatCurrency(mrp),
        amount: this.formatCurrency(amountBeforeDiscount),
        discountPercent: `${discountPercent.toFixed(2)}`,
        gstPercentage: `${gstPercentage.toFixed(2)}`,
        total: this.formatCurrency(total),
      };
    });

    const invoiceData = {
      pharmacy: {
        name: pharmacy.name,
        address: pharmacy.address || '',
        contactNumber: pharmacy.contactNumber || '',
      },
      invoice: {
        id: saleData.id.split('-').pop(),
        customerName: saleData.patientName || '',
        mobile: saleData.patientMobile || '',
        createdAt: `${this.formatDate(saleData.createdAt)} (${this.formatTime(saleData.createdAt)})`,
        paymentNotes: saleData.paymentNotes || '',
      },
      billing: {
        paymentMethod: saleData.paymentMethod || '',
        price: this.formatCurrency(Number(saleData.subtotal)),
        discount: this.formatCurrency(Number(saleData.discountAmount)),
        tax: this.formatCurrency(Number(saleData.gstAmount)),
        totalPrice: this.formatCurrency(Number(saleData.totalAmount)),
      },
      medicines,
    };

    const s3Key = `pharmacy-sales-invoices/${saleData.id}.pdf`;

    let pdfUrl: string;

    const exists = await doesFileExistInS3(s3Key);

    if (exists) {
      pdfUrl = s3ObjectUrl(withEnvPrefix(s3Key));
    } else {
      pdfUrl = await generateAndUploadSaleInvoicePdf(
        pharmacySaleInvoiceTemplate,
        invoiceData,
        saleData.id
      );
    }

    await enqueueWhatsAppTemplate(saleData.patientMobile, {
      key: 'pharmacyInvoice',
      params: {
        customerName: saleData.patientName || 'Customer',
        pharmacyName: pharmacy.name,
        invoiceUrl: pdfUrl,
      },
    });

    return {
      success: true,
      // Queued, not delivered — Meta accepting a message is not proof it
      // arrived, and the send now happens on a background worker.
      message: 'Invoice queued for delivery via WhatsApp',
    };
  }

  static async getSalesStats(pharmacyId: string) {
    const today = new Date();

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const todayStartISO = todayStart.toISOString();
    const tomorrowStartISO = tomorrowStart.toISOString();
    const yesterdayStartISO = yesterdayStart.toISOString();

    const getPercentageChange = (current: number, previous: number): number => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }

      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    const getTrend = (
      percentageChange: number
    ): 'increase' | 'decrease' | 'neutral' => {
      if (percentageChange > 0) return 'increase';
      if (percentageChange < 0) return 'decrease';
      return 'neutral';
    };

    const [
      todaySales,
      yesterdaySales,
      todayUnits,
      yesterdayUnits,
      todayReturns,
      yesterdayReturns,
    ] = await Promise.all([
      database
        .select({
          totalSalesAmount: sql<number>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStartISO}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} < ${sql`${tomorrowStartISO}::timestamp`}
          ), 0)
        `,
          totalInvoices: sql<number>`
          COUNT(${PharmacySalesModel.id})
        `,
        })
        .from(PharmacySalesModel)
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(PharmacySalesModel.createdAt, todayStart),
            lt(PharmacySalesModel.createdAt, tomorrowStart)
          )
        ),

      database
        .select({
          totalSalesAmount: sql<number>`
          COALESCE(SUM(${PharmacySalesModel.totalAmount}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnModel.totalReturnAmount})
            FROM ${PharmacySalesReturnModel}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStartISO}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} < ${sql`${todayStartISO}::timestamp`}
          ), 0)
        `,
          totalInvoices: sql<number>`
          COUNT(${PharmacySalesModel.id})
        `,
        })
        .from(PharmacySalesModel)
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(PharmacySalesModel.createdAt, yesterdayStart),
            lt(PharmacySalesModel.createdAt, todayStart)
          )
        ),

      database
        .select({
          unitsSold: sql<number>`
          COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnItemsModel.returnedQuantity})
            FROM ${PharmacySalesReturnItemsModel}
            INNER JOIN ${PharmacySalesReturnModel}
              ON ${PharmacySalesReturnModel.id} = ${PharmacySalesReturnItemsModel.salesReturnId}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${todayStartISO}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} < ${sql`${tomorrowStartISO}::timestamp`}
          ), 0)
        `,
        })
        .from(PharmacySalesItemsModel)
        .innerJoin(
          PharmacySalesModel,
          eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
        )
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(PharmacySalesModel.createdAt, todayStart),
            lt(PharmacySalesModel.createdAt, tomorrowStart)
          )
        ),

      database
        .select({
          unitsSold: sql<number>`
          COALESCE(SUM(${PharmacySalesItemsModel.quantity}), 0)
          - COALESCE((
            SELECT SUM(${PharmacySalesReturnItemsModel.returnedQuantity})
            FROM ${PharmacySalesReturnItemsModel}
            INNER JOIN ${PharmacySalesReturnModel}
              ON ${PharmacySalesReturnModel.id} = ${PharmacySalesReturnItemsModel.salesReturnId}
            WHERE ${PharmacySalesReturnModel.pharmacyId} = ${pharmacyId}
              AND ${PharmacySalesReturnModel.createdAt} >= ${sql`${yesterdayStartISO}::timestamp`}
              AND ${PharmacySalesReturnModel.createdAt} < ${sql`${todayStartISO}::timestamp`}
          ), 0)
        `,
        })
        .from(PharmacySalesItemsModel)
        .innerJoin(
          PharmacySalesModel,
          eq(PharmacySalesItemsModel.pharmacySalesId, PharmacySalesModel.id)
        )
        .where(
          and(
            eq(PharmacySalesModel.pharmacyId, pharmacyId),
            gte(PharmacySalesModel.createdAt, yesterdayStart),
            lt(PharmacySalesModel.createdAt, todayStart)
          )
        ),

      database
        .select({
          totalReturnAmount: sql<number>`
          COALESCE(SUM(${PharmacySalesReturnModel.totalReturnAmount}), 0)
        `,
        })
        .from(PharmacySalesReturnModel)
        .where(
          and(
            eq(PharmacySalesReturnModel.pharmacyId, pharmacyId),
            gte(PharmacySalesReturnModel.createdAt, todayStart),
            lt(PharmacySalesReturnModel.createdAt, tomorrowStart)
          )
        ),

      database
        .select({
          totalReturnAmount: sql<number>`
          COALESCE(SUM(${PharmacySalesReturnModel.totalReturnAmount}), 0)
        `,
        })
        .from(PharmacySalesReturnModel)
        .where(
          and(
            eq(PharmacySalesReturnModel.pharmacyId, pharmacyId),
            gte(PharmacySalesReturnModel.createdAt, yesterdayStart),
            lt(PharmacySalesReturnModel.createdAt, todayStart)
          )
        ),
    ]);

    const currentSalesAmount = Number(todaySales[0]?.totalSalesAmount || 0);
    const previousSalesAmount = Number(
      yesterdaySales[0]?.totalSalesAmount || 0
    );

    const currentInvoices = Number(todaySales[0]?.totalInvoices || 0);
    const previousInvoices = Number(yesterdaySales[0]?.totalInvoices || 0);

    const currentUnitsSold = Number(todayUnits[0]?.unitsSold || 0);
    const previousUnitsSold = Number(yesterdayUnits[0]?.unitsSold || 0);

    const currentReturns = Number(todayReturns[0]?.totalReturnAmount || 0);
    const previousReturns = Number(yesterdayReturns[0]?.totalReturnAmount || 0);

    const salesAmountChange = getPercentageChange(
      currentSalesAmount,
      previousSalesAmount
    );

    const invoiceChange = getPercentageChange(
      currentInvoices,
      previousInvoices
    );

    const unitsSoldChange = getPercentageChange(
      currentUnitsSold,
      previousUnitsSold
    );

    const returnsChange = getPercentageChange(currentReturns, previousReturns);

    return {
      comparisonPeriod: 'yesterday',

      totalSalesAmount: {
        value: currentSalesAmount,
        percentageChange: salesAmountChange,
        trend: getTrend(salesAmountChange),
      },

      totalInvoices: {
        count: currentInvoices,
        percentageChange: invoiceChange,
        trend: getTrend(invoiceChange),
      },

      totalUnitsSold: {
        count: currentUnitsSold,
        percentageChange: unitsSoldChange,
        trend: getTrend(unitsSoldChange),
      },

      totalReturns: {
        value: currentReturns,
        percentageChange: returnsChange,
        trend: getTrend(returnsChange),
      },
    };
  }
}
