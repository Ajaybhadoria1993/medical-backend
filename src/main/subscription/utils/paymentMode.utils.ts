import { razorpayInstance } from '../../../utils/razorpay';

/**
 * Standardizes raw payment mode strings (from Razorpay methods, database records,
 * or discount types) into user-facing canonical names.
 */
export function normalizeSubscriptionPaymentMode(mode?: string | null): string {
  if (!mode || typeof mode !== 'string') {
    return 'Online';
  }

  const clean = mode.trim().toLowerCase();

  // Discount / free activations
  if (clean === 'coupon') return 'Coupon';
  if (clean === 'credit') return 'Credit';
  if (clean === 'free') return 'Free';
  if (clean === '-' || clean === '') return '-';

  // Digital payment rails
  if (
    clean === 'upi' ||
    clean.includes('gpay') ||
    clean.includes('phonepe') ||
    clean.includes('paytm')
  ) {
    return 'UPI';
  }

  if (
    clean === 'card' ||
    clean === 'debit_card' ||
    clean === 'credit_card' ||
    clean.includes('card')
  ) {
    return 'Card';
  }

  if (
    clean === 'netbanking' ||
    clean === 'net_banking' ||
    clean === 'net banking'
  ) {
    return 'Net Banking';
  }

  if (clean === 'wallet') return 'Wallet';
  if (clean === 'emi') return 'EMI';
  if (clean === 'bank_transfer' || clean === 'bank transfer')
    return 'Bank Transfer';
  if (clean === 'nach' || clean === 'emandate' || clean === 'e_mandate')
    return 'NACH';
  if (clean === 'qr') return 'QR';
  if (clean === 'autopay' || clean === 'auto_pay' || clean === 'mandate')
    return 'AutoPay';

  if (['razorpay', 'online', 'gateway', 'payment gateway'].includes(clean)) {
    return 'Online';
  }

  // Capitalize first letter of each word as fallback
  return mode
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Looks up the actual payment method from Razorpay for a given payment ID
 * and returns the normalized payment mode string.
 */
export async function resolveRazorpayPaymentMode(
  paymentId?: string | null
): Promise<string> {
  if (!paymentId || !paymentId.startsWith('pay_')) {
    return 'Online';
  }

  try {
    const payment = await razorpayInstance.payments.fetch(paymentId);
    return normalizeSubscriptionPaymentMode(payment?.method || 'Online');
  } catch {
    return 'Online';
  }
}
