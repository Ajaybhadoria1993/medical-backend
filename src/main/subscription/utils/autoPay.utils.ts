import type { AutoPayLimit, AutoPayMethod } from '../types/autoPay.types';

// Card and UPI approve AutoPay on a ₹1 check (refunded); a bank mandate registers with ₹0.
export const AUTOPAY_CHECK_PAISE: Record<AutoPayMethod, number> = {
  card: 100,
  upi: 100,
  emandate: 0,
};

const TOKEN_YEARS = 10;

/** How long an AutoPay approval stays valid at Razorpay. */
export const autoPayTokenExpiry = (from = new Date()) => {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + TOKEN_YEARS);
  return d;
};

/** Razorpay's most per AutoPay charge without a PIN (UPI, card) or for a bank mandate; paise. */
export const RAZORPAY_MAX_PER_CHARGE_PAISE: Record<AutoPayMethod, number> = {
  upi: 1_500_000,
  card: 1_500_000,
  emandate: 9_999_900,
};

/** The limit actually sent to Razorpay for a method: ours, capped at Razorpay's most. */
export const limitForMethod = (limitPaise: number, method: AutoPayMethod) =>
  Math.min(limitPaise, RAZORPAY_MAX_PER_CHARGE_PAISE[method]);

// Storage caps are kept in MB (2048 = 2 GB) while one unit is 1024 MB; a cap below one unit is already a count.
export const capInUnits = (maxCap: number | null, unitValue: number) =>
  maxCap === null || maxCap <= 0
    ? 0
    : unitValue > 1 && maxCap >= unitValue
      ? Math.floor(maxCap / unitValue)
      : maxCap;

/** The AutoPay limit in the shape /quote and /auto-pay return (rupees). */
export const limitResponse = (l: AutoPayLimit) => ({
  autoPayLimit: l.limitPaise / 100,
  autoPayLimitLines: l.lines.map((x) => ({
    name: x.name,
    quantity: x.quantity,
    unitPrice: x.unitPaise / 100,
    amount: x.amountPaise / 100,
  })),
  autoPayUncapped: l.uncapped,
  // The screen shows min(autoPayLimit, this) for the chosen method, as checkout sends it.
  autoPayMethodCaps: {
    upi: RAZORPAY_MAX_PER_CHARGE_PAISE.upi / 100,
    card: RAZORPAY_MAX_PER_CHARGE_PAISE.card / 100,
    emandate: RAZORPAY_MAX_PER_CHARGE_PAISE.emandate / 100,
  },
});

/** Most days a Super Admin can add to a plan in one go. */
/** One AutoPay limit for every plan, like other subscriptions: ₹15,000 is RBI's recurring limit without extra bank checks. */
export const AUTOPAY_DEFAULT_LIMIT_PAISE = 15_000_00;

export const MAX_EXTEND_DAYS = 90;

// First charge starts 27-51 h before renewal: the debit (26 h later) lands before it, and one daily run always lands in it.
export const CHARGE_FROM_HOURS = 51;
export const LAST_START_HOURS = 27;
// Razorpay refuses a debit under 25 h after the notice; 26 h leaves room for clock and network delay.
export const NOTICE_HOURS = 26;
