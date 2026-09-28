/**
 * Standardized Payment Modes across Frontend and Backend.
 */
export enum PaymentMode {
  CASH = 'Cash',
  ONLINE = 'Online',
  UPI = 'UPI',
  CARD = 'Card',
  PAY_LATER = 'Pay Later',
  NOT_REQUIRED = 'Not Required',
}

/**
 * Normalizes any incoming payment mode string (e.g. 'razorpay', 'cashfree', 'paylater', 'offline', 'manual')
 * to one of the canonical PaymentMode enum values.
 */
export function normalizePaymentMode(mode?: string | null): string {
  if (!mode || typeof mode !== 'string') {
    return PaymentMode.CASH;
  }
  const clean = mode.trim().toLowerCase();
  if (['online', 'razorpay', 'cashfree'].includes(clean)) {
    return PaymentMode.ONLINE;
  }
  if (['pay later', 'paylater'].includes(clean)) {
    return PaymentMode.PAY_LATER;
  }
  if (['cash', 'offline', 'manual'].includes(clean)) {
    return PaymentMode.CASH;
  }
  if (['upi', 'qr', 'gpay', 'phonepe', 'paytm'].includes(clean)) {
    return PaymentMode.UPI;
  }
  if (['card', 'pos', 'debit', 'credit'].includes(clean)) {
    return PaymentMode.CARD;
  }
  if (
    ['not required', 'free', 'free consultation', 'complimentary'].includes(
      clean
    )
  ) {
    return PaymentMode.NOT_REQUIRED;
  }

  const matchedEnum = Object.values(PaymentMode).find(
    (val) => val.toLowerCase() === clean
  );
  return matchedEnum || mode;
}

export function isOnlinePaymentMode(mode?: string | null): boolean {
  const normalized = normalizePaymentMode(mode);
  return normalized === PaymentMode.ONLINE;
}

export function isOfflinePaymentMode(mode?: string | null): boolean {
  const normalized = normalizePaymentMode(mode);
  return (
    normalized === PaymentMode.CASH ||
    normalized === PaymentMode.CARD ||
    normalized === PaymentMode.UPI
  );
}

export function isPayLaterMode(mode?: string | null): boolean {
  const normalized = normalizePaymentMode(mode);
  return normalized === PaymentMode.PAY_LATER;
}
