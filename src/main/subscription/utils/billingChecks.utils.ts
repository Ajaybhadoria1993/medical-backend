import { sql } from 'drizzle-orm';
import { SubscriptionPaymentModel } from '../models/subscriptionPayment.model';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** The daily match compares this many days of payments with Razorpay. */
export const MATCH_WINDOW_DAYS = 7;
/** A refund we owe that is still not through after this long is flagged. */
export const REFUND_STUCK_AFTER_MS = 2 * DAY_MS;
/** Razorpay's page size when listing payments. */
export const RAZORPAY_PAGE = 100;

/** No Razorpay event for this long usually means the webhook URL or secret is wrong. */
export const WEBHOOK_QUIET_AFTER_MS = 6 * HOUR_MS;
// A few failures a day is normal (expired cards); three or more is worth a look.
export const AUTOPAY_FAILED_ALERT = 3;

export const paiseToRupees = (paise: unknown) => Number(paise ?? 0) / 100;

// The AutoPay ₹1 check is refunded and is not a sale.
export const SALE_PAYMENT = sql`${SubscriptionPaymentModel.kind} <> 'mandate_setup'`;
