import { Request, Response } from 'express';
import { AddOnService } from '../services/addon.service';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { AddOnPricingService } from '../services/billing/addOnPricing.service';
import { CheckoutService } from '../services/billing/checkout.service';
import { PaymentsService } from '../services/billing/payments.service';
import { AddOnChangeService } from '../services/core/addOnChange.service';

export const getActiveAddOns = asyncHandler(
  async (_req: Request, res: Response) => {
    const addOns = await AddOnService.getActiveAddOns();
    return sendOk(res, 'Active add-ons fetched successfully', addOns);
  }
);

export const getAvailableAddOns = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(400, 'Clinic context required');
    const addOns = await AddOnPricingService.available(clinicId);
    return sendOk(res, 'Available add-ons fetched successfully', addOns);
  }
);

export const purchaseAddOn = asyncHandler(
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
    const { addOns, creditPackId, couponCode } = req.validatedBody;
    const checkout = await CheckoutService.startAddOnCheckout({
      clinicId,
      addOns,
      creditPackId,
      couponCode,
      idempotencyKey,
    });
    return sendOk(res, 'Add-on purchase started', checkout);
  }
);

// The price is for the days left in the current period, never the full catalogue price.
export const quoteAddOns = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = req.clinicId;
  if (!clinicId) throw new HttpError(400, 'Clinic context required');
  const { addOns, creditPackId, couponCode } = req.validatedBody;
  const quote = await AddOnPricingService.quote({
    clinicId,
    addOns,
    creditPackId,
    couponCode,
  });
  return sendOk(
    res,
    'Add-on quote fetched successfully',
    AddOnPricingService.toResponse(quote)
  );
});

export const verifyPurchase = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(400, 'Clinic context required');
    const { orderId, paymentId, signature } = req.validatedBody;
    // What was bought comes from our payment row, never from the request body.
    const payment = await PaymentsService.findByOrder(clinicId, orderId);
    // A WhatsApp pack bought alone from the add-ons screen is a credit purchase.
    if (
      !payment ||
      (payment.kind !== 'addon_purchase' && payment.kind !== 'credit_purchase')
    ) {
      throw new HttpError(404, 'This add-on payment was not found.');
    }
    const activated = await PaymentsService.verifyCheckout({
      payment,
      providerPaymentId: paymentId,
      signature,
    });
    if (activated.kind === 'duplicate') {
      return sendOk(
        res,
        'Your plan changed before this payment arrived, so it will be refunded in full.',
        { refunded: true }
      );
    }
    return sendOk(res, 'Add-ons purchased successfully', {
      paymentId: activated.payment.id,
      alreadyApplied: activated.kind === 'already',
    });
  }
);

export const reduceAddOnQuantity = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { reduceBy, deactivateUserIds } = req.validatedBody;

    const result = await AddOnChangeService.reduce(
      clinicId,
      clinicAddOnId,
      reduceBy,
      deactivateUserIds
    );
    const message =
      result!.scheduledQuantity === 0
        ? 'This add-on ends when the current period ends.'
        : `From the next period you will have ${result!.scheduledQuantity}.`;
    return sendOk(res, message, result);
  }
);

export const scheduleAddOnCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { deactivateUserIds } = req.validatedBody;
    const result = await AddOnChangeService.remove(
      clinicId,
      clinicAddOnId,
      deactivateUserIds
    );
    return sendOk(
      res,
      'This add-on ends when the current period ends.',
      result
    );
  }
);

export const undoAddOnCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { clinicAddOnId } = req.validatedParams;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const result = await AddOnChangeService.undo(clinicId, clinicAddOnId);
    return sendOk(res, 'The scheduled change has been undone.', result);
  }
);
