/** Pure rules of the nightly appointment-payment check; amounts in paise. */

/** The Razorpay payment fields the check reads. */
export interface RzpPayment {
  id: string;
  order_id: string | null;
  amount: number;
  status: string;
  amount_refunded?: number;
}

/** The Razorpay refund fields the check reads. */
export interface RzpRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

/** One online-paid visit as our records see it. */
export interface VisitMoney {
  appointmentId: string;
  paymentStatus: string | null;
  hasSnapshot: boolean;
  /** Clinic payment line for this Razorpay payment. */
  paidPaise: number;
  /** Razorpay's share of the fee journal for this payment. */
  feePaise: number;
  /** Online refunds recorded on the visit. */
  refundedPaise: number;
}

export type FindingKind =
  | 'no_booking'
  | 'not_recorded'
  | 'fees_missing'
  | 'amount_differs'
  | 'refund_missing'
  | 'refund_unknown';

export interface Finding {
  kind: FindingKind;
  /** Razorpay payment id, or refund id for refund_unknown. */
  ref: string;
  appointmentId?: string;
  /** Safe to fix without a person: the money side is already settled in our records. */
  fixable: boolean;
}

/** What a Super Admin reads for each kind. */
export const FINDING_LABEL: Record<FindingKind, string> = {
  no_booking: 'money taken, no booking',
  not_recorded: 'payment not recorded',
  fees_missing: 'fees not recorded',
  amount_differs: 'amount differs from Razorpay',
  refund_missing: 'refund at Razorpay not recorded',
  refund_unknown: 'refund not processed at Razorpay',
};

const TAKEN = ['captured', 'refunded'];

/** Compares Razorpay's appointment payments and refunds with our records. */
export function matchAppointmentPayments(
  payments: RzpPayment[],
  refunds: RzpRefund[],
  visitsByOrder: Map<string, VisitMoney>,
  ourOnlineRefundRefs: { ref: string; appointmentId: string }[]
): Finding[] {
  const found: Finding[] = [];
  for (const p of payments) {
    if (!TAKEN.includes(p.status)) continue;
    const v = p.order_id ? visitsByOrder.get(p.order_id) : undefined;
    if (!v) {
      found.push({ kind: 'no_booking', ref: p.id, fixable: false });
      continue;
    }
    const at = { ref: p.id, appointmentId: v.appointmentId };
    if (v.paidPaise === 0) {
      found.push({
        kind: 'not_recorded',
        ...at,
        fixable: v.paymentStatus === 'Paid',
      });
      continue;
    }
    if (v.feePaise === 0 && p.amount > v.paidPaise)
      found.push({ kind: 'fees_missing', ...at, fixable: v.hasSnapshot });
    else if (v.paidPaise + v.feePaise !== p.amount)
      found.push({ kind: 'amount_differs', ...at, fixable: false });
    if ((p.amount_refunded ?? 0) > v.refundedPaise)
      found.push({ kind: 'refund_missing', ...at, fixable: false });
  }
  const processed = new Set(
    refunds.filter((r) => r.status === 'processed').map((r) => r.id)
  );
  for (const r of ourOnlineRefundRefs)
    if (!processed.has(r.ref))
      found.push({
        kind: 'refund_unknown',
        ref: r.ref,
        appointmentId: r.appointmentId,
        fixable: false,
      });
  return found;
}
