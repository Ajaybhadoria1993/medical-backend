import { HttpError } from '../../../middlewear/errorHandler';
import {
  fetchRazorpayOrder,
  verifyRazorpayPayment,
  verifyRazorpaySubscriptionPayment,
  razorpayInstance,
} from '../../../utils/razorpay';

export interface AddOnOrderItem {
  addOnId: string;
  quantity: number;
  billingCycle: 'monthly' | 'yearly';
}

export interface OrderCoupon {
  couponId: number;
  couponCode?: string;
  originalAmount: number;
  discountAmount: number;
}

export interface VerifiedOrder {
  orderId: string;
  clinicId: string;
  planId?: string;
  providerSubscriptionId?: string;
  addOnItems: AddOnOrderItem[];
  amount: number;
  coupon?: OrderCoupon;
  /**
   * Credit for unused days of the subscription this purchase replaces. Written
   * at order-creation time so the verify guard can account for a legitimately
   * reduced payment instead of rejecting it as underpaid.
   */
  prorationCredit: number;
  isSubscription?: boolean;
}

/** Format: "addOnId:qty:m|y,addOnId:qty:m|y" */
export const encodeAddOnItems = (items: AddOnOrderItem[]): string =>
  items
    .map(
      (item) =>
        `${item.addOnId}:${item.quantity}:${item.billingCycle === 'yearly' ? 'y' : 'm'}`
    )
    .join(',');

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

/**
 * Guards against activating a purchase for less money than it costs — e.g. a
 * plan whose price changed after the order was created, or a partial capture.
 * Allows a 1-rupee tolerance for rounding between the two calculations.
 */
export const assertOrderCoversAmount = (
  order: VerifiedOrder,
  expectedAmount: number
): void => {
  if (order.amount + 1 < expectedAmount) {
    throw new HttpError(
      400,
      `Payment amount (₹${order.amount}) does not cover the purchase price (₹${expectedAmount}). Please contact support.`
    );
  }
};

/**
 * Resolves what was actually purchased from the Razorpay order itself.
 *
 * The checkout signature only proves the `orderId|paymentId` pair is genuine —
 * it says nothing about the plan, billing cycle or add-on quantities. Those must
 * come from the order notes written at order-creation time, never from the
 * client's verify payload, otherwise a clinic can pay for the cheapest plan and
 * claim any other one.
 */
export const resolveVerifiedOrder = async (params: {
  orderId: string;
  paymentId: string;
  signature: string;
  clinicId: string;
}): Promise<VerifiedOrder> => {
  const { orderId, paymentId, signature, clinicId } = params;

  const isSubscription = orderId.startsWith('sub_');

  if (isSubscription) {
    const isValidSig =
      verifyRazorpaySubscriptionPayment(orderId, paymentId, signature) ||
      verifyRazorpayPayment(orderId, paymentId, signature);

    if (!isValidSig) {
      throw new HttpError(400, 'Invalid payment signature');
    }

    let rzpSub: any = null;
    try {
      rzpSub = await razorpayInstance.subscriptions.fetch(orderId);
    } catch {
      throw new HttpError(400, 'Payment subscription not found');
    }

    if (!rzpSub) {
      throw new HttpError(400, 'Payment subscription not found');
    }

    const notes = (rzpSub.notes ?? {}) as Record<string, string | number>;
    const orderClinicId = notes.clinicId ? String(notes.clinicId) : undefined;

    if (!orderClinicId || orderClinicId !== clinicId) {
      throw new HttpError(
        403,
        'This payment subscription belongs to another clinic'
      );
    }

    const couponId = notes.couponId
      ? parseInt(String(notes.couponId), 10)
      : NaN;
    const billingCycle = notes.billingCycle
      ? String(notes.billingCycle)
      : 'monthly';
    const providerSubscriptionId = notes.providerSubscriptionId
      ? String(notes.providerSubscriptionId)
      : billingCycle === 'yearly'
        ? 'year_inr'
        : 'month_inr';

    return {
      orderId,
      clinicId: orderClinicId,
      planId: notes.planId ? String(notes.planId) : undefined,
      providerSubscriptionId,
      addOnItems: decodeAddOnItems(
        notes.addOnItems ? String(notes.addOnItems) : undefined
      ),
      amount: Number(
        notes.initialAmount ?? (rzpSub.amount ? rzpSub.amount / 100 : 0)
      ),
      prorationCredit: Number(notes.prorationCredit ?? 0) || 0,
      isSubscription: true,
      coupon: Number.isNaN(couponId)
        ? undefined
        : {
            couponId,
            couponCode: notes.couponCode ? String(notes.couponCode) : undefined,
            originalAmount: Number(notes.originalAmount ?? 0),
            discountAmount: Number(notes.discountAmount ?? 0),
          },
    };
  }

  if (!verifyRazorpayPayment(orderId, paymentId, signature)) {
    throw new HttpError(400, 'Invalid payment signature');
  }

  const order = await fetchRazorpayOrder(orderId);

  if (!order) {
    throw new HttpError(400, 'Payment order not found');
  }

  const notes = (order.notes ?? {}) as Record<string, string | number>;
  const orderClinicId = notes.clinicId ? String(notes.clinicId) : undefined;

  if (!orderClinicId || orderClinicId !== clinicId) {
    throw new HttpError(403, 'This payment order belongs to another clinic');
  }

  const couponId = notes.couponId ? parseInt(String(notes.couponId), 10) : NaN;

  return {
    orderId,
    clinicId: orderClinicId,
    planId: notes.planId ? String(notes.planId) : undefined,
    providerSubscriptionId: notes.providerSubscriptionId
      ? String(notes.providerSubscriptionId)
      : undefined,
    addOnItems: decodeAddOnItems(
      notes.addOnItems ? String(notes.addOnItems) : undefined
    ),
    amount: Number(order.amount) / 100,
    prorationCredit: Number(notes.prorationCredit ?? 0) || 0,
    coupon: Number.isNaN(couponId)
      ? undefined
      : {
          couponId,
          couponCode: notes.couponCode ? String(notes.couponCode) : undefined,
          originalAmount: Number(notes.originalAmount ?? 0),
          discountAmount: Number(notes.discountAmount ?? 0),
        },
  };
};
