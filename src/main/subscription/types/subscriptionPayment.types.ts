/** One line of what a payment bought; every amount is in paise. */
export interface PaymentLine {
  kind:
    | 'plan'
    | 'addon'
    | 'proration_credit'
    | 'coupon'
    | 'adjustment'
    | 'credits'
    /** GST added on top in exclusive mode; inclusive GST stays inside the prices. */
    | 'tax';
  description: string;
  /** On a credits line: the pack bought, its credit type and how many credits it adds. */
  packId?: string;
  creditType?: string;
  credits?: number;
  amountPaise: number;
  planVersionId?: string;
  addOnId?: string;
  billingCycle?: 'monthly' | 'yearly';
  quantity?: number;
  /** For a part-period line (upgrade, add-on bought mid-period). */
  days?: number;
  /** On a part-period add-on line: the full-period price of one unit when bought, so reports never use a later price. */
  unitPaise?: number;
  periodStart?: string;
  periodEnd?: string;
  /** On an add-on line bought while a renewal was pending: the part paid for the next period. */
  nextPeriodPaise?: number;
  /** On a coupon line: the code the clinic entered. */
  couponCode?: string;
}

/** Stored in `subscription_payments.lines`; `version` lets the shape grow without breaking old rows. */
export interface PaymentLines {
  version: 1;
  items: PaymentLine[];
}

/** Name and address copied onto an invoice when it is issued, so later edits never change it. */
export interface InvoiceParty {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  /** GST state code, e.g. "23" for Madhya Pradesh. */
  stateCode?: string;
  postalCode?: string;
  gstin?: string;
}
