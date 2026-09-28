import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { database } from '../../../configurations/dbConnection';
import ExcelJS from 'exceljs';
import {
  CreateMedicineInput,
  UpdateMedicineInput,
} from '../schemas/medicine.schema';
import { PharmacyMedicineService } from '../services/medicine.service';
import { PharmacySupplierService } from '../services/supplier.service';
import { HsnTaxMasterModel } from '../../pharmacy/models/inventoryMasters.model';
import { sendOk } from '../../../utils/response.utils';

export const addMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateMedicineInput;

    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyMedicineService.createMedicine(
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Medicine added successfully',
      data: result,
    });
  }
);

export const getMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacyMedicineService.getMedicines(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        number | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        number | undefined,
      search: (query as Record<string, unknown>).search as string | undefined,
      category: (query as Record<string, unknown>).category as
        string | undefined,
      form: (query as Record<string, unknown>).form as string | undefined,
      status: (query as Record<string, unknown>).status as
        'active' | 'inactive' | undefined,
      hsnId: (query as Record<string, unknown>).hsnId as string | undefined,
      stockStatus: (query as Record<string, unknown>).stockStatus as
        'empty' | 'low' | 'medium' | 'good' | undefined,
      tag: (query as Record<string, unknown>).tag as string | undefined,
    });

    res.json({
      success: true,
      data: result.medicines,
      pagination: result.pagination,
    });
  }
);

export const updateMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const payload = req.validatedBody as UpdateMedicineInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyMedicineService.updateMedicine(
      id,
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Medicine updated successfully',
      data: result,
    });
  }
);

export const getHsnController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await database.transaction(async (tx) => {
      const hsn = await tx.select().from(HsnTaxMasterModel);

      return hsn;
    });

    return res.json({
      success: true,
      data: result,
    });
  }
);

export const getMedicineCategoriesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const query = req.validatedQuery || {};

    const result = await PharmacyMedicineService.getMedicineCategories(
      pharmacyId,
      {
        pageNumber: (query as Record<string, unknown>).pageNumber as
          number | undefined,

        pageSize: (query as Record<string, unknown>).pageSize as
          number | undefined,

        search: (query as Record<string, unknown>).search as string | undefined,
      }
    );

    res.json({
      success: true,
      data: result.categories,
      pagination: result.pagination,
    });
  }
);

export const getMedicineTagsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const query = req.validatedQuery || {};

    const result = await PharmacyMedicineService.getMedicineTags(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        number | undefined,

      pageSize: (query as Record<string, unknown>).pageSize as
        number | undefined,

      search: (query as Record<string, unknown>).search as string | undefined,
    });

    res.json({
      success: true,
      data: result.tags,
      pagination: result.pagination,
    });
  }
);

export const getMedicineBrandsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const query = req.validatedQuery || {};

    const result = await PharmacyMedicineService.getMedicineBrands(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        number | undefined,

      pageSize: (query as Record<string, unknown>).pageSize as
        number | undefined,

      search: (query as Record<string, unknown>).search as string | undefined,
    });

    res.json({
      success: true,
      data: result.brands,
      pagination: result.pagination,
    });
  }
);

export const exportAllMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const medicines =
      await PharmacyMedicineService.exportAllMedicines(pharmacyId);

    const workbook = new ExcelJS.Workbook();

    const worksheet = workbook.addWorksheet('Medicines');

    worksheet.columns = [
      { header: 'Sr. No.', key: 'srNo', width: 10 },
      { header: 'SKU', key: 'sku', width: 10 },
      { header: 'Medicine Name', key: 'medicineName', width: 30 },
      { header: 'Brand Name', key: 'brandName', width: 20 },
      { header: 'Composition', key: 'composition', width: 30 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Form', key: 'form', width: 15 },
      { header: 'Shelf', key: 'shelf', width: 15 },
      { header: 'Reorder', key: 'reorder', width: 12 },
      { header: 'Pack Of', key: 'packOf', width: 10 },
      { header: 'Available Quantity', key: 'availableQuantity', width: 18 },
      { header: 'HSN', key: 'hsnCode', width: 15 },
      { header: 'GST Percentage', key: 'hsnGstPercentage', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
    ];

    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.getRow(1).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };

    worksheet.views = [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ];

    medicines.forEach((medicine, index) => {
      worksheet.addRow({
        srNo: index + 1,
        sku: medicine.sku ?? '',
        medicineName: medicine.medicineName ?? '',
        brandName: medicine.brandName ?? '',
        composition: medicine.composition ?? '',
        category: medicine.category ?? '',
        form: medicine.form ?? '',
        shelf: medicine.shelf ?? '',
        reorder: medicine.reorder ?? '',
        packOf: medicine.packOf ?? '',
        availableQuantity: medicine.availableQuantity ?? 0,
        hsnCode: medicine.hsnCode ?? '',
        hsnGstPercentage: medicine.hsnGstPercentage ?? '',
        status: medicine.status ?? '',
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=all-medicines.xlsx'
    );

    await workbook.xlsx.write(res);

    res.end();
  }
);

export const downloadMedicineSampleTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const workbook =
      await PharmacyMedicineService.generateMedicineSampleTemplate();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=medicine-upload-template.xlsx'
    );

    await workbook.xlsx.write(res);

    res.end();
  }
);

export const importMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    if (!req.file) {
      throw new HttpError(400, 'Excel file is required');
    }

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyMedicineService.importMedicinesFromExcel(
      pharmacyId,
      Buffer.from(req.file.buffer)
    );

    res.status(200).json({
      success: true,
      message: 'Medicine import completed',
      data: result,
    });
  }
);

export const getMedicineStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyMedicineService.getMedicineStats(pharmacyId);

    res.json({
      success: true,
      message: 'Medicine statistics retrieved successfully',
      data: result,
    });
  }
);

// Admin-facing variants: pharmacyId comes from the route param (any pharmacy
// in the admin's clinic), not from req.user's own pharmacy assignment.

export const adminGetMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };

    const query = (req.validatedQuery || {}) as Record<string, unknown>;
    const result = await PharmacyMedicineService.getMedicines(pharmacyId, {
      pageNumber: query.pageNumber as number | undefined,
      pageSize: query.pageSize as number | undefined,
      search: query.search as string | undefined,
      category: query.category as string | undefined,
      form: query.form as string | undefined,
      status: query.status as 'active' | 'inactive' | undefined,
      hsnId: query.hsnId as string | undefined,
      stockStatus: query.stockStatus as
        'empty' | 'low' | 'medium' | 'good' | undefined,
      tag: query.tag as string | undefined,
    });

    res.json({
      success: true,
      data: result.medicines,
      pagination: result.pagination,
    });
  }
);

export const adminAddMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };

    const payload = req.validatedBody as CreateMedicineInput;
    const result = await PharmacyMedicineService.createMedicine(
      payload,
      pharmacyId
    );

    return sendOk(res, 'Medicine added successfully', result);
  }
);

export const adminUpdateMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId, id } = req.validatedParams as {
      pharmacyId: string;
      id: string;
    };

    const payload = req.validatedBody as UpdateMedicineInput;
    const result = await PharmacyMedicineService.updateMedicine(
      id,
      payload,
      pharmacyId
    );

    return sendOk(res, 'Medicine updated successfully', result);
  }
);
