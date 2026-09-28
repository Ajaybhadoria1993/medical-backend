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
    const id = req.params.id as string;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const payload: UpdateMedicinePayload = req.body;
    const updated = await MedicineService.updateMedicine(id, userId, payload);
    return res.status(200).json({ success: true, data: updated });
  }
);

export const deleteMedicineController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const deleted = await MedicineService.softDeleteMedicine(id, userId);
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
