import type { EntryType } from '../../money';

export type LedgerKind = 'charge' | 'payment' | 'refund';

export interface LedgerRow {
  id: string;
  entryType: EntryType;
  amountPaise: number;
  lineRef: string | null;
  reversesEntryId: string | null;
}

export interface MoneyMove {
  appointmentId: string;
  /** Omitted: everything due (payment) or everything received (refund). */
  amountPaise?: number;
  paymentMode: string | null;
  channel?: 'desk' | 'online';
  gatewayRef?: string | null;
  requestId: string;
  reason?: string | null;
  actorId: string;
}

/** A money event the caller knows exactly (a gateway payment or refund, a desk booking paid on the
 *  spot): recorded as given, never guessed from the payment row's status. */
export interface DirectMove {
  kind: 'pay' | 'refund';
  /** Omitted: everything due (pay) or everything received (refund). */
  amountPaise?: number;
  paymentMode: string | null;
  channel: 'desk' | 'online';
  gatewayRef?: string | null;
  reason?: string | null;
  /** Stable per real event (e.g. razorpay:pay:<id>), so every path confirming it records it once. */
  requestId: string;
}

/** What a normal visit was before a treatment plan covered it, so leaving the plan restores it. */
export interface VisitCover {
  type: string | null;
  price: string | null;
  primary: string | null;
  mode: string | null;
}
