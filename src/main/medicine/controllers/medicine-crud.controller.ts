import { Request, Response } from 'express';
import {
  MedicineService,
  CreateMedicinePayload,
  UpdateMedicinePayload,
  SearchMedicineQuery,
} from '../services/medicine.service';
import { asyncHandler } from '../../../middlewear/errorHandler';

export const uploadMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file || !req.file.buffer) {
      return res
        .status(400)
        .json({ success: false, message: 'CSV file is required' });
    }

    // Assumes req.user is populated by auth middleware
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await MedicineService.uploadMedicines(
      req.file.buffer,
      userId
    );
    return res.status(200).json({ success: true, ...result });
  }
);

export const createMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload: CreateMedicinePayload = {
      ...req.body,
      createdByUserId: req.user?.id,
    };

    if (!payload.createdByUserId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const medicine = await MedicineService.createMedicine(payload);
    return res.status(201).json({ success: true, data: medicine });
  }
);

export const updateMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const medicineId = req.params.medicineId as string; // Using medicineId as per route param
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const payload: UpdateMedicinePayload = req.body;
    const updated = await MedicineService.updateMedicine(
      medicineId,
      userId,
      payload
    );
    return res.status(200).json({ success: true, data: updated });
  }
);

export const deleteMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const medicineId = req.params.medicineId as string; // Using medicineId as per route param
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const deleted = await MedicineService.softDeleteMedicine(
      medicineId,
      userId
    );
    return res.status(200).json({ success: true, data: deleted });
  }
);

export const searchMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const query: SearchMedicineQuery = {
      ...req.query,
      userId: req.user?.id, // Scope to user + global
    };

    const result = await MedicineService.searchMedicines(query);
    return res.status(200).json({ success: true, data: result });
  }
);

export const getMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const medicineId = req.params.medicineId as string;
    const result = await MedicineService.getMedicineById(medicineId);
    res.json({ success: true, result });
  }
);

export const getAllMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;

    const q = req.query.q as string | undefined;
    const page = Math.max(Number(req.query.pageNumber) || 1, 1);
    // A ranked search only needs the top rows; the full list keeps 500.
    const pageSize = Math.min(
      Math.max(Number(req.query.pageSize) || (q ? 25 : 500), 1),
      500
    );

    const isActive =
      req.query.isActive !== undefined
        ? req.query.isActive === 'true'
        : undefined;

    const requiresPrescription =
      req.query.requiresPrescription !== undefined
        ? req.query.requiresPrescription === 'true'
        : undefined;

    const isFavorite =
      req.query.isFavorite !== undefined
        ? req.query.isFavorite === 'true'
        : undefined;

    const category = req.query.category as string | undefined;

    const result = await MedicineService.getAllMedicines({
      page,
      pageSize,
      userId,
      q,
      category,
      requiresPrescription,
      isFavorite,
      isActive,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

export const getUniqueFormsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;

    const forms = await MedicineService.getUniqueForms(userId);
    res.status(200).json({ success: true, forms });
  }
);

export const getDistinctGenericNamesController = asyncHandler(
  async (req: Request, res: Response) => {
    const searchTerm = req.query.q as string;
    const result = await MedicineService.getDistinctGenericNames(searchTerm);
    res.status(200).json({ success: true, data: result });
  }
);

export const getDistinctBrandNamesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await MedicineService.getDistinctBrandNames();
    res.status(200).json({ success: true, data: result });
  }
);

export const getDistinctManufacturersController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await MedicineService.getDistinctManufacturers();
    res.status(200).json({ success: true, data: result });
  }
);

export const getDistinctCategoriesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await MedicineService.getDistinctCategories();
    res.status(200).json({ success: true, data: result });
  }
);

export const toggleMedicineStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const medicineId = req.params.medicineId as string;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res
        .status(400)
        .json({ success: false, message: 'isActive (boolean) is required' });
    }

    const result = await MedicineService.toggleMedicineStatus(
      medicineId,
      userId,
      isActive
    );
    return res.status(200).json({ success: true, data: result });
  }
);
