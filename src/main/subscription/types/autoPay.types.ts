export type AutoPayMethod = 'card' | 'upi' | 'emandate';

/** One part of the AutoPay limit: the plan, or an add-on at the most the plan allows. */
export interface AutoPayLimitLine {
  name: string;
  /** Most units the plan allows (1 for the plan itself). */
  quantity: number;
  unitPaise: number;
  amountPaise: number;
}

export interface AutoPayLimit {
  limitPaise: number;
  lines: AutoPayLimitLine[];
  /** Add-ons with no cap: buying many can need a new approval. */
  uncapped: string[];
}

/** What the daily renewal run did for one mandate. */
export type RenewalOutcome =
  | 'charged'
  /** Order created with the pre-debit notice; the charge follows once Razorpay has sent it. */
  | 'notice_sent'
  | 'gave_up'
  | 'not_due'
  | 'already_started'
  | 'not_eligible'
  | 'above_limit'
  | 'failed';
