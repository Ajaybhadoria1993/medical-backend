import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { getCompressionStats } from '../../../middlewear/fileCompression.middleware';
import ExcelJS from 'exceljs';
import {
  AddStockInput,
  UpdateStockInput,
  UpdateStockMedicineInput,
} from '../schemas/stock.schema';
import { PharmacyStockService } from '../services/stock.service';
import { PharmacySupplierService } from '../services/supplier.service';

export const addStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as AddStockInput;

    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.addStock(payload, pharmacyId);

    res.json({
      success: true,
      message: 'Stock added successfully',
      data: result,
    });
  }
);

export const getStocksController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacyStockService.getStocks(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        number | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        number | undefined,
      search: (query as Record<string, unknown>).search as string | undefined,
      supplierId: (query as Record<string, unknown>).supplierId as
        string | undefined,
      pharmacyStockPaymentStatus: (query as Record<string, unknown>)
        .pharmacyStockPaymentStatus as
        'paid' | 'unpaid' | 'partial' | undefined,
      startDate: (query as Record<string, unknown>).startDate as
        string | undefined,
      endDate: (query as Record<string, unknown>).endDate as string | undefined,
      medicineName: (query as Record<string, unknown>).medicineName as
        string | undefined,
      batch: (query as Record<string, unknown>).batch as string | undefined,
    });

    res.json({
      success: true,
      data: result.stocks,
      pagination: result.pagination,
    });
  }
);

export const getStockByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.getStockById(id, pharmacyId);

    res.json({ success: true, data: result });
  }
);

export const updateStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const payload = req.validatedBody as UpdateStockInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.updateStock(
      id,
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Stock updated successfully',
      data: result,
    });
  }
);

export const updateStockMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockMedicineId } = req.params as { stockMedicineId: string };
    const payload = req.validatedBody as UpdateStockMedicineInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.updateStockMedicine(
      stockMedicineId,
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Stock medicine updated successfully',
      data: result,
    });
  }
);

export const updateStockInvoiceController = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params as { stockId: string };
    const invoiceUrl = (req.file as any)?.location || null;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.updateStockInvoice(
      stockId,
      invoiceUrl,
      pharmacyId
    );

    const compressionStats = getCompressionStats(req.file);

    return res.status(200).json({
      success: true,
      message: invoiceUrl
        ? 'Invoice uploaded successfully'
        : 'Invoice not uploaded',
      data: result,
      ...(compressionStats && { compression: compressionStats }),
    });
  }
);

export const getAvailableStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacyStockService.getAvailableStock(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        number | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        number | undefined,
      search: (query as Record<string, unknown>).search as string | undefined,
      category: (query as Record<string, unknown>).category as
        string | undefined,
      form: (query as Record<string, unknown>).form as string | undefined,
      medicineName: (query as Record<string, unknown>).medicineName as
        string | undefined,
    });

    res.json({
      success: true,
      data: result.stocks,
      pagination: result.pagination,
    });
  }
);

export const getStockCacheController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.getStockCache(pharmacyId);

    res.json({
      success: true,
      data: result,
    });
  }
);

export const exportAllStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const stocks = await PharmacyStockService.exportAllStock(pharmacyId);

    const workbook = new ExcelJS.Workbook();

    const worksheet = workbook.addWorksheet('Stock Export');

    worksheet.columns = [
      { header: 'Purchase No.', key: 'srNo', width: 10 },
      { header: 'Purchase Date', key: 'purchaseDate', width: 15 },
      { header: 'Supplier Name', key: 'supplierName', width: 25 },
      { header: 'Contact Person', key: 'contactPerson', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Payment Notes', key: 'paymentNotes', width: 25 },
      { header: 'Units', key: 'units', width: 10 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Invoice', key: 'invoice', width: 20 },

      { header: 'SKU', key: 'sku', width: 20 },
      { header: 'Medicine Name', key: 'medicineName', width: 30 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Form', key: 'form', width: 15 },
      { header: 'Batch', key: 'batch', width: 20 },
      { header: 'Expiry', key: 'expiry', width: 15 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'MRP', key: 'mrp', width: 12 },
      { header: 'Cost', key: 'cost', width: 12 },
      { header: 'Total Cost', key: 'totalCost', width: 15 },
    ];

    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.views = [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ];

    const groupedStocks = stocks.reduce(
      (acc, stock) => {
        const stockId = stock.stockId!;

        if (!acc[stockId]) {
          acc[stockId] = [];
        }

        acc[stockId].push(stock);

        return acc;
      },
      {} as Record<string, typeof stocks>
    );

    let serialNumber = 1;
    let currentRow = 2;

    Object.values(groupedStocks).forEach((purchase) => {
      const startRow = currentRow;

      purchase.forEach((item) => {
        worksheet.addRow({
          srNo: serialNumber,
          purchaseDate: item.purchaseDate,
          supplierName: item.supplierName,
          contactPerson: item.contactPerson,
          phone: item.phone,
          paymentStatus: item.paymentStatus,
          paymentNotes: item.paymentNotes,
          units: item.units,
          totalAmount: item.totalAmount,
          invoice: item.invoice,

          sku: item.sku,
          medicineName: item.medicineName,
          category: item.category,
          form: item.form,
          batch: item.batch,
          expiry: item.expiry,
          quantity: item.quantity,
          mrp: item.mrp,
          cost: item.cost,
          totalCost: item.totalCost,
        });

        currentRow++;
      });

      const endRow = currentRow - 1;
      serialNumber++;

      if (endRow > startRow) {
        worksheet.mergeCells(`B${startRow}:B${endRow}`);
        worksheet.mergeCells(`C${startRow}:C${endRow}`);
        worksheet.mergeCells(`D${startRow}:D${endRow}`);
        worksheet.mergeCells(`E${startRow}:E${endRow}`);
        worksheet.mergeCells(`F${startRow}:F${endRow}`);
        worksheet.mergeCells(`G${startRow}:G${endRow}`);
        worksheet.mergeCells(`H${startRow}:H${endRow}`);
        worksheet.mergeCells(`I${startRow}:I${endRow}`);
        worksheet.mergeCells(`J${startRow}:J${endRow}`);

        for (let col = 1; col <= 10; col++) {
          worksheet.getCell(startRow, col).alignment = {
            vertical: 'middle',
            horizontal: 'center',
          };
        }
      }
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader('Content-Disposition', 'attachment; filename=all-stock.xlsx');

    await workbook.xlsx.write(res);

    res.end();
  }
);

export const downloadStockSampleTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const workbook =
      await PharmacyStockService.generateStockSampleTemplate(pharmacyId);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=stock-upload-template.xlsx'
    );

    await workbook.xlsx.write(res);

    res.end();
  }
);

export const importStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    if (!req.file) {
      throw new HttpError(400, 'Excel file is required');
    }

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.importStockFromExcel(
      pharmacyId,
      Buffer.from(req.file.buffer)
    );

    res.status(200).json({
      success: true,
      message: 'Stock import completed',
      data: result,
    });
  }
);

export const getStockStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyStockService.getStockStats(pharmacyId);

    res.json({
      success: true,
      message: 'Stock statistics retrieved successfully',
      data: result,
    });
  }
);

export const getExpiryStockController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const query = req.validatedQuery || {};

    const result = await PharmacyStockService.getExpiryStock(pharmacyId, {
      pageNumber: query.pageNumber as number | undefined,
      pageSize: query.pageSize as number | undefined,
      medicineName: query.medicineName as string | undefined,
      expiryDays: query.expiryDays as number | undefined,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }
);
