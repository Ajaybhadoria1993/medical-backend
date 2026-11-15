import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { AutoPayService } from '../../services/billing/autoPay.service';

const clinicOf = (req: Request) => {
  if (!req.clinicId) throw new HttpError(400, 'Clinic context required');
  return req.clinicId;
};

/** GET /api/v2/subscription/auto-pay — on/off, method and limit, or why it can't be turned on. */
export const getAutoPay = asyncHandler(async (req: Request, res: Response) => {
  return sendOk(
    res,
    'AutoPay fetched',
    await AutoPayService.status(clinicOf(req))
  );
});

/** POST /api/v2/subscription/auto-pay/setup — the approval checkout for a plan already paid for. */
export const startAutoPaySetup = asyncHandler(
  async (req: Request, res: Response) => {
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new HttpError(
        400,
        'AutoPay could not start. Please refresh the page and try again.'
      );
    }
    const checkout = await AutoPayService.startSetup({
      clinicId: clinicOf(req),
      method: req.validatedBody.method,
      idempotencyKey,
      email: req.user?.email,
    });
    return sendOk(res, 'AutoPay approval started', checkout);
  }
);

/** POST /api/v2/subscription/auto-pay/disable — turn AutoPay off; renewals are then paid by hand. */
export const disableAutoPay = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'AutoPay turned off',
      await AutoPayService.disable(clinicOf(req))
    );
  }
);

/** POST /api/v2/subscription/auto-pay/verify — Checkout's success callback for the approval. */
export const verifyAutoPaySetup = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'AutoPay approval received',
      await AutoPayService.verifySetup(clinicOf(req), req.validatedBody)
    );
  }
);
