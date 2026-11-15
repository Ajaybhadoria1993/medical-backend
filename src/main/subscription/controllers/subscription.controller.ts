import { Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk, sendCreated } from '../../../utils/response.utils';
import { billingCycleFromProviderId } from '../utils/billingCycle.utils';
import { SubscriptionOverviewService } from '../services/core/subscriptionOverview.service';
import { ScheduledChangeService } from '../services/core/scheduledChange.service';
import { CheckoutService } from '../services/billing/checkout.service';
import { PaymentsService } from '../services/billing/payments.service';
import { InvoiceService } from '../services/billing/invoice.service';
import { OwnerSubscriptionService } from '../services/core/ownerSubscription.service';
import { SubscriptionActivityService } from '../services/subscriptionActivity.service';

// update a subscription plan (Super Admin)
export const updatePlan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  const payload = req.validatedBody;

  const plan = await SubscriptionService.updatePlan(id, payload);

  return sendOk(res, 'Plan updated successfully', plan);
});

// get all subscription plans
// Hidden plans are off sale; only the Super Admin list (getAllPlans) shows them.
export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await SubscriptionService.getPlans();
  return sendOk(
    res,
    'Plans fetched successfully',
    plans.filter((p) => p.isActive)
  );
});

export const getAllPlans = asyncHandler(
  async (_req: Request, res: Response) => {
    const plans = await SubscriptionService.getPlans();
    return sendOk(res, 'Plans fetched successfully', plans);
  }
);

export const subscribeClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }
    const { planId, providerSubscriptionId, couponCode, autoPay } =
      req.validatedBody;

    const result = await CheckoutService.subscribe({
      clinicId,
      planId,
      cycle: billingCycleFromProviderId(providerSubscriptionId),
      couponCode,
      idempotencyKey: req.get('Idempotency-Key'),
      autoPay: autoPay ? { ...autoPay, email: req.user?.email } : undefined,
    });
    if ('requiresPayment' in result) {
      return sendOk(res, 'You are on the Free plan', result);
    }
    return sendOk(res, 'Payment order created', result);
  }
);

// New endpoint to verify payment and complete subscription
export const verifyAndSubscribe = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const targetId =
      req.validatedBody.orderId || req.validatedBody.subscriptionId;
    const { paymentId, signature } = req.validatedBody;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    if (!targetId) {
      throw new HttpError(400, 'orderId or subscriptionId required');
    }

    // Every checkout creates its payment row first; an order without one is not ours.
    const payment = await PaymentsService.findByOrder(clinicId, targetId);
    if (!payment) {
      throw new HttpError(
        404,
        "We couldn't find this payment. If money left your account, contact support with your payment ID."
      );
    }

    const activated = await PaymentsService.verifyCheckout({
      payment,
      providerPaymentId: paymentId,
      signature,
    });
    if (activated.kind === 'duplicate') {
      return sendOk(
        res,
        'You already have this plan, so this payment will be refunded in full.',
        { refunded: true }
      );
    }
    const subscription = await OwnerSubscriptionService.getCurrent(
      'clinic',
      clinicId
    );
    const body = {
      subscription: subscription?.subscription ?? null,
      staffReactivated: activated.staffReactivated,
      doctorsReactivated: activated.doctorsReactivated,
    };
    return activated.kind === 'already'
      ? sendOk(res, 'Subscription already activated', body.subscription)
      : sendCreated(res, 'Payment verified and subscription activated', body);
  }
);

/**
 * Report a client-side payment failure or cancellation (e.g. user cancelled Razorpay modal).
 * Deduplicates by orderId so duplicate entries are not created if webhook also fires.
 */
export const reportPaymentFailed = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { orderId, reason, errorCode, droppedCheckout } = req.validatedBody;
    const payment = orderId
      ? await PaymentsService.findByOrder(clinicId, orderId)
      : null;
    // Only our own checkout orders are tracked; anything else has nothing to record.
    if (!payment) {
      return sendOk(res, 'Payment failure noted', { recorded: false });
    }

    const isDroppedCheckout =
      Boolean(droppedCheckout) ||
      /dismiss|closed|cancel|abandon|drop.?off/i.test(reason || '');
    // Records the timeline row and sends the failure email, once per attempt.
    await PaymentsService.recordFailure(payment, {
      reason: reason ?? errorCode ?? null,
      dropped: isDroppedCheckout,
    });

    return sendOk(res, 'Payment failure recorded successfully', {
      recorded: true,
    });
  }
);

// The old subscription webhook URLs use the one Razorpay router, like every other URL.
export { razorpayWebhookController } from '../../payment';

export const scheduleSubscriptionCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const subscription = await ScheduledChangeService.scheduleCancel(
      clinicId,
      req.body?.reason
    );
    return sendOk(
      res,
      'Subscription will be cancelled at end of current billing period',
      {
        subscription,
        cancelAtPeriodEnd: true,
        expiresAt: subscription.currentPeriodEnd,
      }
    );
  }
);

export const undoSubscriptionCancellation = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const subscription = await ScheduledChangeService.undoCancel(clinicId);
    return sendOk(res, 'Subscription cancellation has been reversed', {
      subscription,
      cancelAtPeriodEnd: false,
    });
  }
);

// Pre-check plan downgrade limits & over-quota accounts before scheduling
export const checkPlanDowngrade = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const { targetPlanId } = req.validatedBody;
    const { LimitationService } =
      await import('../services/limitation.service');

    const result = await LimitationService.checkDowngradeLimits(
      clinicId,
      targetPlanId
    );

    return sendOk(res, 'Downgrade resource check completed', result);
  }
);

export const schedulePlanDowngrade = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const {
      targetPlanId,
      billingCycle,
      preferredActiveStaffIds,
      preferredActiveDoctorIds,
      exactKeep,
    } = req.validatedBody;
    const { targetPlan, effectiveAt } =
      await ScheduledChangeService.scheduleDowngrade(clinicId, {
        targetPlanId,
        billingCycle,
        keepDoctorIds: preferredActiveDoctorIds,
        keepStaffIds: preferredActiveStaffIds,
        exactKeep,
      });

    return sendOk(res, 'Plan change scheduled for end of billing period', {
      scheduledPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        slug: targetPlan.slug,
      },
      effectiveAt,
    });
  }
);

export const undoScheduledPlanChange = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    await ScheduledChangeService.undoDowngrade(clinicId);
    return sendOk(res, 'Scheduled plan change has been cancelled', {
      scheduledPlanId: null,
    });
  }
);

export const retrySubscriptionPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const checkout = await CheckoutService.retryLast(clinicId);
    return sendOk(res, 'Retry payment order created', checkout);
  }
);

export const getClinicSubscription = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const overview = await SubscriptionOverviewService.get(clinicId);
    return sendOk(res, 'Clinic subscription fetched successfully', overview);
  }
);

// get billing history for a clinic
/**
 * GET /api/v1/subscription/activity
 *
 * The subscription activity timeline. Reads the append-only audit log rather
 * than deriving events from current state, so actions that move no money
 * (AutoPay toggles, cancellation, undo, scheduled add-on removal) are visible
 * and keep the date they actually happened.
 */
export const getSubscriptionActivity = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const limitRaw = Number(req.query.limit);
    const beforeRaw =
      typeof req.query.before === 'string' ? new Date(req.query.before) : null;

    const activity = await SubscriptionActivityService.list(clinicId, {
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      before:
        beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined,
    });

    return sendOk(res, 'Subscription activity fetched successfully', activity);
  }
);

export const getBillingHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    const history = await InvoiceService.history(clinicId);

    return sendOk(res, 'Billing history fetched successfully', history);
  }
);

export const downloadInvoicePdf = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const { invoiceId } = req.params;

    if (!clinicId) {
      throw new HttpError(400, 'Clinic context required');
    }

    if (!invoiceId) {
      throw new HttpError(400, 'Invoice ID required');
    }

    const { pdf, fileName } = await InvoiceService.pdfFor(
      clinicId,
      String(invoiceId)
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return res.status(200).send(pdf);
  }
);
