import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { listPacksOnSale } from '../../../credits';
import { CheckoutService } from '../../services/billing/checkout.service';
import { creditPacksAllowed } from '../../services/billing/addOnPricing.service';

/** GET /api/v2/subscription/credits/packs — WhatsApp packs the clinic can buy now. */
export const listCreditPacks = asyncHandler(
  async (req: Request, res: Response) => {
    // A plan without the switch on sells none, so the screens hide the row.
    if (req.clinicId && !(await creditPacksAllowed(req.clinicId))) {
      return sendOk(res, 'Packs fetched successfully', []);
    }
    const packs = await listPacksOnSale('whatsapp');
    return sendOk(
      res,
      'Packs fetched successfully',
      packs.map((p) => ({ ...p, priceInr: Number(p.priceInr) }))
    );
  }
);

/** POST /api/v2/subscription/credits/checkout — starts a one-time payment for a pack. */
export const startCreditCheckout = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(400, 'Clinic context required');
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new HttpError(
        400,
        'The checkout could not start. Please refresh the page and try again.'
      );
    }
    const checkout = await CheckoutService.startCreditCheckout({
      clinicId,
      packId: req.validatedBody.packId,
      idempotencyKey,
    });
    return sendOk(res, 'Pack purchase started', checkout);
  }
);
