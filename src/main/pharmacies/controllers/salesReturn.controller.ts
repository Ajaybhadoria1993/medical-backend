import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacySupplierService } from '../services/supplier.service';
import { CreateSalesReturnInput } from '../schemas/salesReturn.schema';
import { PharmacySalesReturnService } from '../services/salesReturn.service';

export const createSalesReturnController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreateSalesReturnInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacySalesReturnService.createSalesReturn(
      payload,
      pharmacyId,
      userId
    );

    res.json({
      success: true,
      message: 'Sales return created successfully',
      data: result,
    });
  }
);

export const getSalesReturnsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacySalesReturnService.getSalesReturns(
      pharmacyId,
      {
        pageNumber: (query as Record<string, unknown>).pageNumber as
          number | undefined,
        pageSize: (query as Record<string, unknown>).pageSize as
          number | undefined,
        saleId: (query as Record<string, unknown>).saleId as string | undefined,
        startDate: (query as Record<string, unknown>).startDate as
          string | undefined,
        endDate: (query as Record<string, unknown>).endDate as
          string | undefined,
        search: (query as Record<string, unknown>).search as string | undefined,
        refundMethod: (query as Record<string, unknown>).refundMethod as
          string | undefined,
      }
    );

    res.json({
      success: true,
      data: result.salesReturns,
      pagination: result.pagination,
    });
  }
);
