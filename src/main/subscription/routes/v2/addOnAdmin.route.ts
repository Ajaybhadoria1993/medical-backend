import express from 'express';
import {
  requireAuth,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  cancelAddOnPrice,
  listAddOnPrices,
  listAddOns,
  scheduleAddOnPrice,
  updateAddOn,
} from '../../controllers/v2/addOnAdmin.controller';
import {
  addOnIdParamsSchema,
  addOnPriceParamsSchema,
  scheduleAddOnPriceSchema,
  updateAddOnSchema,
} from '../../schemas/addOnAdmin.schemas';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

/** @route GET /api/v2/subscription/add-on-admin — every add-on, price now, next change, usage */
router.get('/', listAddOns);

/** @route PATCH /api/v2/subscription/add-on-admin/:addOnId — wording, or stop / start selling */
router.patch(
  '/:addOnId',
  validate(addOnIdParamsSchema, 'params'),
  validate(updateAddOnSchema, 'body'),
  updateAddOn
);

/** @route GET /api/v2/subscription/add-on-admin/:addOnId/prices — price changes, newest first */
router.get(
  '/:addOnId/prices',
  validate(addOnIdParamsSchema, 'params'),
  listAddOnPrices
);

/** @route POST /api/v2/subscription/add-on-admin/:addOnId/prices — a new price from a date */
router.post(
  '/:addOnId/prices',
  validate(addOnIdParamsSchema, 'params'),
  validate(scheduleAddOnPriceSchema, 'body'),
  scheduleAddOnPrice
);

/** @route DELETE /api/v2/subscription/add-on-admin/:addOnId/prices/:priceId — cancel a change before it starts */
router.delete(
  '/:addOnId/prices/:priceId',
  validate(addOnPriceParamsSchema, 'params'),
  cancelAddOnPrice
);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/',
    description: 'Add-ons with price now and next change (Super Admin)',
    tags: ['subscription', 'add-ons'],
  },
  {
    method: 'patch',
    path: '/:addOnId',
    description: 'Change add-on wording or sale status (Super Admin)',
    tags: ['subscription', 'add-ons'],
  },
  {
    method: 'get',
    path: '/:addOnId/prices',
    description: 'Add-on price changes (Super Admin)',
    tags: ['subscription', 'add-ons'],
  },
  {
    method: 'post',
    path: '/:addOnId/prices',
    description: 'Schedule an add-on price change (Super Admin)',
    tags: ['subscription', 'add-ons'],
  },
  {
    method: 'delete',
    path: '/:addOnId/prices/:priceId',
    description: 'Cancel a scheduled add-on price change (Super Admin)',
    tags: ['subscription', 'add-ons'],
  },
];
