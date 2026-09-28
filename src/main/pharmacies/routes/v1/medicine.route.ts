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
import { requireUserSubscription } from '../../../../middlewear/subscriptionAccess.middleware';

const medicineRouter = express.Router();

medicineRouter.post(
  '/add-medicine',
  requireAuth,
  requireUserSubscription,
  validate(createMedicineSchema, 'body'),
  addMedicineController
);

medicineRouter.get(
  '/get-all-medicines',
  requireAuth,
  requireUserSubscription,
  validate(getMedicinesQuerySchema, 'query'),
  getMedicinesController
);

medicineRouter.put(
  '/update-medicine/:id',
  requireAuth,
  requireUserSubscription,
  validate(updateMedicineParamsSchema, 'params'),
  validate(updateMedicineSchema, 'body'),
  updateMedicineController
);

medicineRouter.get(
  '/get-hsn',
  requireAuth,
  requireUserSubscription,
  getHsnController
);

medicineRouter.get(
  '/get-medicine-categories',
  requireAuth,
  requireUserSubscription,
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
  requireUserSubscription,
  validate(getMedicineBrandsQuerySchema, 'query'),
  getMedicineBrandsController
);

medicineRouter.get(
  '/export-all-medicines',
  requireAuth,
  requireUserSubscription,
  exportAllMedicinesController
);

medicineRouter.get(
  '/download-medicine-sample-template',
  requireAuth,
  requireUserSubscription,
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
  requireUserSubscription,
  getMedicineStatsController
);

export default medicineRouter;
