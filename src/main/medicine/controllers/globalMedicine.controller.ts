import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { GlobalMedicineService } from '../services/globalMedicine.service';

export const getMedicineDataController = asyncHandler(
  async (req: Request, res: Response) => {
    const { medicine_name, composition, page, limit } =
      req.validatedQuery || {};

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageSize = Math.max(Number(limit) || 10, 1);

    const result = await GlobalMedicineService.getMedicineData({
      medicine_name,
      composition,
      page: pageNumber,
      limit: pageSize,
    });

    return res.status(200).json({ success: true, ...result });
  }
);
