// src/main/medicine/routes/v1/globalMedicine.route.ts
import express from 'express';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { getMedicineDataQuerySchema } from '../../schemas/globalMedine.schemas';
import { getMedicineDataController } from '../../controllers/globalMedicine.controller';

const globalMedicineRouter = express.Router();

/**
 * @route GET /api/v1/medicine/global-medicine/medicine-data
 * @desc Search secondary database medicine data
 * @access Private (Doctor)
 */
globalMedicineRouter.get(
  '/medicine-data',
  requireAuth,
  validate(getMedicineDataQuerySchema, 'query'),
  getMedicineDataController
);

// ============ Global Medicine Documentation ============

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/medicine/global-medicine/medicine-data',
  description: 'Query medicine data from secondary database',
  query: getMedicineDataQuerySchema,
  tags: ['medicine'],
});

export default globalMedicineRouter;
