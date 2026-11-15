import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import {
  createMedicineSchema,
  getMedicineBrandsQuerySchema,
  getMedicineCategoriesQuerySchema,
  getMedicinesQuerySchema,
  updateMedicineParamsSchema,
  updateMedicineSchema,
} from '../../schemas/medicine.schema';
import {
  addMedicineController,
  downloadMedicineSampleTemplateController,
  exportAllMedicinesController,
  getHsnController,
  getMedicineBrandsController,
  getMedicineCategoriesController,
  getMedicinesController,
  getMedicineStatsController,
  getMedicineTagsController,
  importMedicinesController,
  updateMedicineController,
} from '../../controllers/medicine.controller';
import { uploadMedicineImport } from '../../../../configurations/s3/pharmacy.storage';
import {
  FEATURE_KEYS,
  requireFeature,
} from '../../../../middlewear/limitation.middleware';

const medicineRouter = express.Router();

medicineRouter.post(
  '/add-medicine',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(createMedicineSchema, 'body'),
  addMedicineController
);

medicineRouter.get(
  '/get-all-medicines',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getMedicinesQuerySchema, 'query'),
  getMedicinesController
);

medicineRouter.put(
  '/update-medicine/:id',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(updateMedicineParamsSchema, 'params'),
  validate(updateMedicineSchema, 'body'),
  updateMedicineController
);

medicineRouter.get(
  '/get-hsn',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getHsnController
);

medicineRouter.get(
  '/get-medicine-categories',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getMedicineCategoriesQuerySchema, 'query'),
  getMedicineCategoriesController
);

medicineRouter.get(
  '/get-medicine-tags',
  requireAuth,
  validate(getMedicineCategoriesQuerySchema, 'query'),
  getMedicineTagsController
);

medicineRouter.get(
  '/get-medicine-brands',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  validate(getMedicineBrandsQuerySchema, 'query'),
  getMedicineBrandsController
);

medicineRouter.get(
  '/export-all-medicines',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  exportAllMedicinesController
);

medicineRouter.get(
  '/download-medicine-sample-template',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  downloadMedicineSampleTemplateController
);

medicineRouter.post(
  '/import-medicine',
  requireAuth,
  uploadMedicineImport.single('file'),
  importMedicinesController
);

medicineRouter.get(
  '/stats',
  requireAuth,
  requireFeature(FEATURE_KEYS.PHARMACY_INTEGRATION),
  getMedicineStatsController
);

export default medicineRouter;
