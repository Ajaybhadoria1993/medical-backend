import type { BillingMismatch } from '../models/billingMismatch.model';
import type { SubscriptionPayment } from '../models/subscriptionPayment.model';

/** The fields of a Razorpay payment the match job compares. */
export interface RzpPayment {
  id: string;
  order_id?: string;
  status: string;
  amount: number;
  refund_status?: string | null;
}

/** A difference between one of our payments and Razorpay's. */
export interface FoundMismatch {
  kind: BillingMismatch['kind'];
  row: SubscriptionPayment;
  providerPaymentId: string | null;
  ours: Record<string, unknown>;
  theirs: Record<string, unknown>;
}
