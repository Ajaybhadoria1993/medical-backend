import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import {
  CreateSupplierInput,
  UpdateSupplierInput,
} from '../schemas/supplier.schema';
import ExcelJS from 'exceljs';
import { PharmacySupplierService } from '../services/supplier.service';

export const addSupplierController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateSupplierInput;

    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySupplierService.createSupplier(
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Supplier created successfully',
      data: result,
    });
  }
);

export const getSuppliersController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacySupplierService.getSuppliers(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        | number
        | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        | number
        | undefined,
      search: (query as Record<string, unknown>).search as string | undefined,
      status: (query as Record<string, unknown>).status as
        | 'active'
        | 'inactive'
        | undefined,
    });

    res.json({
      success: true,
      data: result.suppliers,
      pagination: result.pagination,
    });
  }
);

export const getSupplierByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const result = await PharmacySupplierService.getSupplierById(
      id,
      pharmacyId
    );

    res.json({ success: true, data: result });
  }
);

export const updateSupplierController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const payload = req.validatedBody as UpdateSupplierInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySupplierService.updateSupplier(
      id,
      payload,
      pharmacyId
    );

    res.json({
      success: true,
      message: 'Supplier updated successfully',
      data: result,
    });
  }
);

export const downloadSupplierSampleTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const workbook =
      await PharmacySupplierService.generateSupplierSampleTemplate();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=supplier-upload-template.xlsx'
    );

    await workbook.xlsx.write(res);

    res.end();
  }
);

export const importSuppliersController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    if (!req.file) {
      throw new HttpError(400, 'Excel file is required');
    }

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySupplierService.importSuppliersFromExcel(
      pharmacyId,
      Buffer.from(req.file.buffer)
    );

    res.status(200).json({
      success: true,
      message: 'Supplier import completed',
      data: result,
    });
  }
);

export const exportAllSuppliersController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const suppliers =
      await PharmacySupplierService.exportAllSuppliers(pharmacyId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Suppliers');

    worksheet.columns = [
      { header: 'Sr. No.', key: 'srNo', width: 10 },
      { header: 'Supplier Name', key: 'supplierName', width: 30 },
      { header: 'Contact Person', key: 'contactPerson', width: 25 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'GST Number', key: 'gstNumber', width: 20 },
      { header: 'PAN Number', key: 'panNumber', width: 18 },
      { header: 'Credit Days', key: 'creditDays', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    suppliers.forEach((supplier, index) => {
      worksheet.addRow({
        srNo: index + 1,
        supplierName: supplier.supplierName ?? '',
        contactPerson: supplier.contactPerson ?? '',
        phone: supplier.phone ?? '',
        email: supplier.email ?? '',
        address: supplier.address ?? '',
        gstNumber: supplier.gstNumber ?? '',
        panNumber: supplier.panNumber ?? '',
        creditDays: supplier.creditDays ?? 0,
        status: supplier.status ?? '',
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=all-suppliers.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();
  }
);

export const getSupplierStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySupplierService.getSupplierStats(pharmacyId);

    res.json({
      success: true,
      message: 'Supplier statistics retrieved successfully',
      data: result,
    });
  }
);
