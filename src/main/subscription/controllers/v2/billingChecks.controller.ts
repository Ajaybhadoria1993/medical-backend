import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { BillingMatchService } from '../../services/billing/billingMatch.service';
import { BillingReadService } from '../../services/billing/billingRead.service';
import { BillingAdminService } from '../../services/billing/billingAdmin.service';
import { WebhookService } from '../../services/billing/webhook.service';
import { RazorpayLiveService } from '../../services/billing/razorpayLive.service';
import { BillingTestService } from '../../services/billing/billingTest.service';

const actor = (req: Request) => {
  if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
  return { userId: req.user.id, reason: req.validatedBody.reason as string };
};

/** GET /api/v2/subscription/billing-checks — open differences with Razorpay and webhook health. */
export const getBillingChecks = asyncHandler(
  async (_req: Request, res: Response) => {
    return sendOk(
      res,
      'Billing checks fetched',
      await BillingMatchService.overview()
    );
  }
);

/** GET /api/v2/subscription/billing-checks/clinic/:clinicId — one clinic's payments and AutoPay. */
export const getClinicBilling = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'Clinic billing fetched',
      await BillingReadService.clinic(req.validatedParams.clinicId)
    );
  }
);

/** POST …/clinic/:clinicId/payments/:paymentId/refund — full refund; the plan stays. */
export const refundClinicPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, paymentId } = req.validatedParams;
    return sendOk(
      res,
      'Refund started',
      await BillingAdminService.refund(clinicId, paymentId, actor(req))
    );
  }
);

/** POST …/clinic/:clinicId/extend — add days to the running paid plan. */
export const extendClinicPlan = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;
    return sendOk(
      res,
      'Plan extended',
      await BillingAdminService.extend(
        clinicId,
        req.validatedBody.days,
        actor(req)
      )
    );
  }
);

/** POST …/clinic/:clinicId/autopay/cancel — turn the clinic's AutoPay off. */
export const cancelClinicAutoPay = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'AutoPay turned off',
      await BillingAdminService.cancelAutoPay(
        req.validatedParams.clinicId,
        actor(req)
      )
    );
  }
);

/** POST …/clinic/:clinicId/invoices/:invoiceId/resend — email the receipt and invoice again. */
export const resendClinicInvoice = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, invoiceId } = req.validatedParams;
    await BillingAdminService.resendInvoice(clinicId, invoiceId, actor(req));
    return sendOk(res, 'Invoice email queued', null);
  }
);

/** POST /api/v2/subscription/billing-checks/run — compare with Razorpay now instead of waiting for 04:00. */
export const runBillingChecks = asyncHandler(
  async (_req: Request, res: Response) => {
    return sendOk(
      res,
      'Billing check finished',
      await BillingMatchService.runNow()
    );
  }
);

/** POST /api/v2/subscription/billing-checks/:id/retry — apply a captured payment or retry a stuck refund. */
export const retryBillingCheck = asyncHandler(
  async (req: Request, res: Response) => {
    return sendOk(
      res,
      'Retried',
      await BillingMatchService.retry(req.validatedParams.id)
    );
  }
);

/** GET …/billing-checks/test — whether the staging test tool is on (dev/staging with a Razorpay test key). */
export const getBillingTestEnabled = asyncHandler(
  async (_req: Request, res: Response) =>
    sendOk(res, 'Test tool status', { enabled: BillingTestService.enabled() })
);

/** GET …/billing-checks/clinic/:clinicId/test — the clinic's latest renewal and period, polled by the test card. */
export const getBillingTestStatus = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Test status',
      await BillingTestService.status(req.validatedParams.clinicId)
    )
);

/** POST …/billing-checks/clinic/:clinicId/test/:action — move this clinic's renewal and run the real job (staging only). */
export const runBillingTest = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
    const out = await BillingTestService.run(
      req.validatedParams.clinicId,
      req.validatedParams.action,
      req.user.id
    );
    return sendOk(res, out.summary, out);
  }
);

/** GET …/billing-checks/clinic/:clinicId/razorpay — this clinic's payments and AutoPay compared with Razorpay now. */
export const checkClinicWithRazorpay = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Compared with Razorpay',
      await RazorpayLiveService.check(req.validatedParams.clinicId)
    )
);

/** GET …/billing-checks/clinic/:clinicId/payments/:paymentId/razorpay — one payment as Razorpay has it (read only). */
export const checkPaymentWithRazorpay = asyncHandler(
  async (req: Request, res: Response) =>
    sendOk(
      res,
      'Payment read from Razorpay',
      await RazorpayLiveService.checkPayment(
        req.validatedParams.clinicId,
        req.validatedParams.paymentId
      )
    )
);

/** POST …/billing-checks/clinic/:clinicId/razorpay/sync — make ours match Razorpay; reason required, logged. */
export const syncClinicWithRazorpay = asyncHandler(
  async (req: Request, res: Response) => {
    const by = actor(req);
    const out = await RazorpayLiveService.sync(
      req.validatedParams.clinicId,
      by
    );
    return sendOk(res, `Synced with Razorpay: ${out.fixed} fixed`, out);
  }
);

/** POST /api/v2/subscription/billing-checks/webhooks/:id/retry — give a stuck Razorpay event fresh tries and run it now. */
export const retryStuckWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user?.id) throw new HttpError(401, 'Sign in again to continue.');
    const after = await WebhookService.retryStuck(
      req.validatedParams.id,
      req.user.id
    );
    return sendOk(
      res,
      after?.status === 'processed'
        ? 'Event applied'
        : 'Retried; it will keep trying in the background',
      after
    );
  }
);

/** POST /api/v2/subscription/billing-checks/:id/resolve — a Super Admin closes it with what they did. */
export const resolveBillingCheck = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId, reason } = actor(req);
    return sendOk(
      res,
      'Marked resolved',
      await BillingMatchService.resolve(req.validatedParams.id, userId, reason)
    );
  }
);
