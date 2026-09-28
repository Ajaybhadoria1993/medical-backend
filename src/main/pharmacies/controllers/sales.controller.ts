import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { CreateSaleInput } from '../schemas/sales.schema';
import { PharmacySalesService } from '../services/sales.service';
import { PharmacySupplierService } from '../services/supplier.service';

export const createSaleController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateSaleInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySalesService.createSale(
      payload,
      pharmacyId,
      userId
    );

    res.json({
      success: true,
      message: 'Sale created successfully',
      data: result,
    });
  }
);

export const getSalesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacySalesService.getSales(pharmacyId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        | number
        | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        | number
        | undefined,
      startDate: (query as Record<string, unknown>).startDate as
        | string
        | undefined,
      endDate: (query as Record<string, unknown>).endDate as string | undefined,
      search: (query as Record<string, unknown>).search as string | undefined,
      paymentMethod: (query as Record<string, unknown>).paymentMethod as
        | string
        | undefined,
      prescriptionId: (query as Record<string, unknown>).prescriptionId as
        | string
        | undefined,
    });

    res.json({
      success: true,
      data: result.sales,
      pagination: result.pagination,
    });
  }
);

export const getSaleByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySalesService.getSaleById(id, pharmacyId);

    res.json({ success: true, data: result });
  }
);

export const sendInvoiceWhatsAppController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { saleId } = req.params as { saleId: string };
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySalesService.sendInvoiceViaWhatsApp(
      saleId,
      pharmacyId
    );

    res.json(result);
  }
);

export const getSalesStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySalesService.getSalesStats(pharmacyId);

    res.json({
      success: true,
      message: 'Sales statistics retrieved successfully',
      data: result,
    });
  }
);
