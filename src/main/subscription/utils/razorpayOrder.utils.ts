import type { Payments } from 'razorpay/dist/types/payments';
import { HttpError } from '../../../middlewear/errorHandler';
import { callRazorpaySdk, razorpayInstance } from '../../../utils/razorpay';

export type RazorpayPayment = Payments.RazorpayPayment;

export interface AddOnOrderItem {
  addOnId: string;
  quantity: number;
  billingCycle: 'monthly' | 'yearly';
}

/** Format: "addOnId:qty:m|y,addOnId:qty:m|y" */
export const decodeAddOnItems = (encoded?: string): AddOnOrderItem[] => {
  if (!encoded) return [];

  return encoded
    .split(',')
    .map((chunk) => {
      const [addOnId, qty, cycle] = chunk.split(':');
      return {
        addOnId,
        quantity: Math.max(1, parseInt(qty, 10) || 1),
        billingCycle: (cycle === 'y' ? 'yearly' : 'monthly') as
          'monthly' | 'yearly',
      };
    })
    .filter((item) => item.addOnId);
};

const fetchPayment = (paymentId: string): Promise<RazorpayPayment> =>
  callRazorpaySdk('Razorpay payment fetch', () =>
    razorpayInstance.payments.fetch(paymentId)
  );

/**
 * Guards against activating a purchase whose money was never collected.
 *
 * The checkout signature is issued when a payment is *authorized*, not when it
 * is captured. On a manual-capture account an authorized payment can lapse and
 * be auto-refunded, so a valid signature alone used to activate plans that were
 * never paid for. Activation must wait for `captured`.
 *
 * Plan and add-on orders are created with `payment_capture: 1`, so callers
 * verifying an order pass `captureIfAuthorized` to capture a still-authorized
 * payment, as the order already asked. Subscription charges are captured by
 * Razorpay itself and are only checked here.
 */
export const ensurePaymentCaptured = async (params: {
  paymentId: string;
  orderId?: string;
  /** Minimum captured amount in rupees; allows ₹1 for rounding. */
  minAmount?: number;
  captureIfAuthorized?: boolean;
  /** The AutoPay ₹1 check is refunded right after approval (by us or Razorpay); refunded still means paid. */
  acceptRefunded?: boolean;
}): Promise<RazorpayPayment> => {
  const { paymentId, orderId, minAmount, captureIfAuthorized, acceptRefunded } =
    params;

  let payment = await fetchPayment(paymentId);

  if (orderId && payment.order_id !== orderId) {
    throw new HttpError(400, 'Payment does not belong to this order');
  }

  if (payment.status === 'authorized' && captureIfAuthorized) {
    try {
      payment = await callRazorpaySdk('Razorpay payment capture', () =>
        razorpayInstance.payments.capture(
          paymentId,
          payment.amount,
          payment.currency
        )
      );
    } catch (error) {
      // Razorpay rejects a second capture, so a webhook or auto-capture that
      // won the race is not a failure.
      payment = await fetchPayment(paymentId);
      if (payment.status !== 'captured') throw error;
    }
  }

  if (
    payment.status !== 'captured' &&
    !(acceptRefunded && payment.status === 'refunded')
  ) {
    throw new HttpError(
      409,
      payment.status === 'authorized'
        ? 'Payment is authorized but not yet captured. Your purchase will activate once the payment completes.'
        : `Payment has not been completed (status: ${payment.status}).`
    );
  }

  if (minAmount != null && Number(payment.amount) / 100 + 1 < minAmount) {
    throw new HttpError(
      400,
      `Captured amount (₹${Number(payment.amount) / 100}) does not cover the purchase price (₹${minAmount}). Please contact support.`
    );
  }

  return payment;
};
