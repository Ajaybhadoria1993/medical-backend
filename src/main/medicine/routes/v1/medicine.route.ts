// src/main/medicine/routes/v1/medicine.route.ts
import express from 'express';
import { ensure1mgJwt } from '../../../../middlewear/ensure1mgJwt';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  createMedicineController,
  deleteMedicineController,
  getAllMedicinesController,
  getDistinctBrandNamesController,
  getDistinctCategoriesController,
  getDistinctGenericNamesController,
  getDistinctManufacturersController,
  getMedicineController,
  getUniqueFormsController,
  searchMedicinesController,
  toggleMedicineStatusController,
  updateMedicineController,
  uploadMedicinesController,
} from '../../controllers/medicine-crud.controller';
import {
  drugStaticController,
  getLocationsController,
  searchAllController,
  searchSuggestionController,
} from '../../controllers/medicine.controller';
import {
  createMedicineSchema,
  drugstaticParamsSchemas,
  drugstaticQuerySchemas,
  locationsQuerySchema,
  medicineParamsSchema,
  searchAllQuerySchema,
  searchAutoCompleteQuerySchema,
  searchMedicineQuerySchema,
  updateMedicineSchema,
} from '../../schemas/medine.schemas';

const medicineRouter = express.Router();

import multer from 'multer';
import {
  enforceClinicAutoLogout,
  requireAuth,
  // requireDoctor,
  requireUser,
} from '../../../../middlewear/auth.middleware';
const uploadCsv = multer({ storage: multer.memoryStorage() });

// ============ Medicine CRUD Routes ============

/**
 * @route POST /api/v1/medicine/medicines/upload
 * @desc Bulk upload medicines via CSV file
 * @access Private (Doctor)
 */
medicineRouter.post(
  '/medicines/upload',
  requireAuth,
  // requireDoctor,
  uploadCsv.single('file'),
  (req, res, next) => {
    // Basic validation if file is present
    if (!req.file) return res.status(400).json({ message: 'File is required' });
    next();
  },
  uploadMedicinesController
);

/**
 * @route POST /api/v1/medicine/medicines
 * @desc Create a new medicine entry
 * @access Private (Doctor)
 */
medicineRouter.post(
  '/medicines',
  requireAuth,
  // requireDoctor,
  enforceClinicAutoLogout,
  validate(createMedicineSchema, 'body'),
  createMedicineController
);

/**
 * @route GET /api/v1/medicine/medicines/search
 * @desc Search medicines with filters
 * @access Private (Doctor)
 */
medicineRouter.get(
  '/medicines/search',
  requireAuth,
  // requireDoctor,
  enforceClinicAutoLogout,
  validate(searchMedicineQuerySchema, 'query'),
  searchMedicinesController
);

/**
 * @route GET /api/v1/medicine/medicines
 * @desc Get all medicines (paginated)
 * @access Private (Doctor)
 */
medicineRouter.get(
  '/medicines',
  requireAuth,
  // requireDoctor,
  validate(searchMedicineQuerySchema, 'query'),
  getAllMedicinesController
);

medicineRouter.get('/medicines/forms', requireAuth, getUniqueFormsController);

/**
 * @route GET /api/v1/medicine/medicines/lists/generics
 * @desc Get list of distinct generic names for medicines
 * @access Private (Doctor)
 */
medicineRouter.get(
  '/medicines/lists/generics',
  requireAuth,
  // requireDoctor,
  getDistinctGenericNamesController
);

/**
 * @route GET /api/v1/medicine/medicines/lists/brands
 * @desc Get list of distinct brand names for medicines
 * @access Private (Doctor)
 */
medicineRouter.get(
  '/medicines/lists/brands',
  requireAuth,
  // requireDoctor,
  getDistinctBrandNamesController
);
medicineRouter.get(
  '/medicines/lists/manufacturers',
  requireAuth,
  // requireDoctor,
  enforceClinicAutoLogout,
  getDistinctManufacturersController
);
medicineRouter.get(
  '/medicines/lists/categories',
  requireAuth,
  // requireDoctor,
  getDistinctCategoriesController
);

// Get medicine by ID
medicineRouter.get(
  '/medicines/:medicineId',
  ensure1mgJwt,
  validate(medicineParamsSchema, 'params'),

  getMedicineController
);

// Update medicine
medicineRouter.patch(
  '/medicines/:medicineId',
  requireAuth,
  // requireDoctor,
  validate(medicineParamsSchema, 'params'),
  validate(updateMedicineSchema, 'body'),
  enforceClinicAutoLogout,
  updateMedicineController
);

// Toggle medicine active status (enable/disable)
medicineRouter.patch(
  '/medicines/:medicineId/toggle-status',
  requireAuth,
  // requireDoctor,
  validate(medicineParamsSchema, 'params'),
  enforceClinicAutoLogout,
  toggleMedicineStatusController
);

// Delete medicine
medicineRouter.delete(
  '/medicines/:medicineId',
  requireAuth,
  // requireDoctor,
  validate(medicineParamsSchema, 'params'),
  deleteMedicineController
);

// ============ 1mg Proxy Routes (existing) ============

medicineRouter.get(
  '/',
  requireAuth,
  // requireDoctor,
  validate(locationsQuerySchema, 'query'),
  getLocationsController
);

// const customLimit = rateLimit({ max: 10, windowSec: 30 });
medicineRouter.get(
  '/search/all',
  requireAuth,
  // requireDoctor,
  // customLimit,
  validate(searchAllQuerySchema, 'query'),
  searchAllController
);

medicineRouter.get(
  '/search/suggestion',
  requireAuth,
  requireUser,
  validate(searchAutoCompleteQuerySchema, 'query'),
  searchSuggestionController
);

medicineRouter.get(
  '/drug-static/:drug_sku_id',
  ensure1mgJwt,
  validate(drugstaticQuerySchemas, 'query'),
  validate(drugstaticParamsSchemas, 'params'),
  drugStaticController
);

export default medicineRouter;

// ============ Medicine CRUD Documentation ============

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/medicine/medicines',
  description: 'Create a new medicine',
  requestSchema: createMedicineSchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/search',
  description: 'Search medicines with filters',
  query: searchMedicineQuerySchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines',
  description: 'Get all medicines (Paginated)',
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/lists/generics',
  description: 'Get distinct generic names',
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/lists/brands',
  description: 'Get distinct brand names',
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/lists/manufacturers',
  description: 'Get distinct manufacturers',
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/lists/categories',
  description: 'Get distinct categories',
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/medicines/:medicineId',
  description: 'Get medicine by ID',
  params: medicineParamsSchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/medicine/medicines/:medicineId',
  description: 'Update medicine information',
  params: medicineParamsSchema,
  requestSchema: updateMedicineSchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/medicine/medicines/:medicineId',
  description: 'Soft delete medicine',
  params: medicineParamsSchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/medicine/medicines/:medicineId/toggle-status',
  description: 'Toggle medicine active status (enable/disable)',
  params: medicineParamsSchema,
  tags: ['medicine'],
});

// ============ 1mg Proxy Documentation (existing) ============

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine',
  description: 'Get locations (1mg proxy)',
  query: locationsQuerySchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/search/all',
  description: 'Search all medicine (1mg proxy)',
  query: searchAllQuerySchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/search/suggestion',
  description: 'Get medicine suggestions (1mg proxy)',
  query: searchAutoCompleteQuerySchema,
  tags: ['medicine'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/drug-static/:drug_sku_id',
  description: 'Get drug static data (1mg proxy)',
  query: drugstaticQuerySchemas,
  params: drugstaticParamsSchemas,
  tags: ['medicine'],
});
