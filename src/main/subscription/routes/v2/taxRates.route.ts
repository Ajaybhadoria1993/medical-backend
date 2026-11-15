import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  getTaxRates,
  previewTaxRate,
  scheduleTaxRate,
  undoTaxRate,
} from '../../controllers/v2/taxRates.controller';
import {
  previewTaxRateSchema,
  scheduleTaxRateSchema,
  taxRateIdParamsSchema,
} from '../../schemas/taxRate.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route GET /api/v2/subscription/tax-rates — GST in force, the scheduled change and the history
 *  @access Super Admin */
router.get('/', getTaxRates);

/** @route POST /api/v2/subscription/tax-rates/preview — each plan's price today and under a proposed GST
 *  @access Super Admin */
router.post('/preview', validate(previewTaxRateSchema, 'body'), previewTaxRate);

/** @route POST /api/v2/subscription/tax-rates — schedule a GST change, or apply it now
 *  @access Super Admin (a rise needs 30 days' notice unless applied now; one scheduled change at a time) */
router.post('/', validate(scheduleTaxRateSchema, 'body'), scheduleTaxRate);

/** @route DELETE /api/v2/subscription/tax-rates/:id — undo a GST change before it starts
 *  @access Super Admin */
router.delete('/:id', validate(taxRateIdParamsSchema, 'params'), undoTaxRate);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'GST in force, scheduled change and history (Super Admin)',
    tags: ['subscription', 'gst'],
  },
  {
    method: 'post',
    path: '/preview',
    description: 'Plan prices under a proposed GST (Super Admin)',
    tags: ['subscription', 'gst'],
  },
  {
    method: 'post',
    path: '/',
    description: 'Schedule a GST change or apply it now (Super Admin)',
    tags: ['subscription', 'gst'],
  },
  {
    method: 'delete',
    path: '/:id',
    description: 'Undo a scheduled GST change (Super Admin)',
    tags: ['subscription', 'gst'],
  },
];
