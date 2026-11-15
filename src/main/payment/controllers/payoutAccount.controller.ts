import type { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { PayoutAccountSetupService } from '../services/payoutAccount/payoutAccountSetup.service';
import { PayoutAccountWebhookService } from '../services/payoutAccount/payoutAccountWebhook.service';
import {
  PayoutAccountSubmitService,
  type PayoutDocumentFile,
} from '../services/payoutAccount/payoutAccountSubmit.service';

/** Razorpay is given the caller's IP when it records terms acceptance. */
const clientIpOf = (req: Request) =>
  req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';

/** Clinic id from the token, never from the request. */
const clinicOf = (req: Request) => {
  if (!req.clinicId) throw new HttpError(400, 'Clinic context required');
  return req.clinicId;
};

/** POST: the one setup form (details + document files); answers with the status card. */
export const submitPayoutAccountController = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await PayoutAccountSubmitService.submit(
      clinicOf(req),
      req.validatedBody.details,
      (req.files as PayoutDocumentFile[] | undefined) ?? [],
      clientIpOf(req)
    );
    return sendOk(res, card.label, card);
  }
);

/** GET: the status card. */
export const getPayoutAccountController = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await PayoutAccountSubmitService.card(clinicOf(req));
    return sendOk(res, card.label, card);
  }
);

/** PUT /bank: change the bank account after setup; answers with the status card. */
export const changePayoutBankController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = clinicOf(req);
    await PayoutAccountSetupService.updateSettlementBank(
      clinicId,
      req.validatedBody,
      clientIpOf(req)
    );
    const card = await PayoutAccountSubmitService.card(clinicId);
    return sendOk(res, 'Bank account updated', card);
  }
);

/** POST /refresh: "Check Status Now" asks Razorpay directly (no webhook needed); answers with the card. */
export const refreshPayoutAccountController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = clinicOf(req);
    await PayoutAccountWebhookService.refresh(clinicId);
    const card = await PayoutAccountSubmitService.card(clinicId);
    return sendOk(res, card.label, card);
  }
);
