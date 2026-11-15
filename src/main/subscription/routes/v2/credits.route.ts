import express from 'express';
import { z } from 'zod';
import {
  requireAuth,
  requireClinic,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  listCreditPacks,
  startCreditCheckout,
} from '../../controllers/v2/credits.controller';
import { requireBillingAdmin } from '../../middlewares/billingAdmin.middleware';

const router = express.Router();
router.use(requireAuth, requireBillingAdmin, requireClinic);

/** @route GET /api/v2/subscription/credits/packs — WhatsApp packs on sale */
router.get('/packs', listCreditPacks);

/** @route POST /api/v2/subscription/credits/checkout — one-time payment for a pack; send an Idempotency-Key header */
router.post(
  '/checkout',
  validate(z.object({ packId: z.string().uuid('Choose a pack') }), 'body'),
  startCreditCheckout
);

export default router;

export const apiDocs = [
  {
    method: 'get',
    path: '/packs',
    description: 'WhatsApp packs the clinic can buy (Admin)',
    tags: ['subscription', 'credits'],
  },
  {
    method: 'post',
    path: '/checkout',
    description: 'Start a one-time payment for a WhatsApp pack (Admin)',
    tags: ['subscription', 'credits'],
  },
];
