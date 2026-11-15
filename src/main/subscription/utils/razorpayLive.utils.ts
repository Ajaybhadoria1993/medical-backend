/** What Razorpay says about one of our payment rows, reduced to what we compare. */
export type RazorpayPaymentState =
  'captured' | 'refunded' | 'failed' | 'not_paid' | 'unknown';

/** Our row's status vs Razorpay's; `apply` means Razorpay has the money and we never applied it. */
export function comparePayment(
  ours: string,
  theirs: RazorpayPaymentState,
  kind?: string
): { match: boolean; action: 'apply' | null } {
  if (theirs === 'unknown') return { match: true, action: null };
  // The AutoPay ₹1 approval check is refunded by Razorpay on its own; paid-then-refunded is expected.
  if (kind === 'mandate_setup' && theirs === 'refunded' && ours === 'captured')
    return { match: true, action: null };
  if (theirs === 'captured') {
    return ours === 'captured'
      ? { match: true, action: null }
      : ours === 'refunded'
        ? { match: false, action: null }
        : { match: false, action: 'apply' };
  }
  if (theirs === 'refunded')
    return { match: ours === 'refunded', action: null };
  // Razorpay holds no money for it: any of our "not paid" states agree.
  return {
    match: ['created', 'pending', 'abandoned', 'failed'].includes(ours),
    action: null,
  };
}

/** Our mandate status vs Razorpay's token (null: a state we do not track). Off here but live at
 *  Razorpay: the clinic's "off" wins, so the fix is cancelling at Razorpay, never turning ours back on. */
export function compareMandate(
  ours: string,
  theirs: string | null
): { match: boolean; action: 'cancel_at_razorpay' | 'sync_ours' | null } {
  if (theirs === null || theirs === ours) return { match: true, action: null };
  if (
    (ours === 'cancelled' || ours === 'failed') &&
    (theirs === 'active' || theirs === 'paused')
  )
    return { match: false, action: 'cancel_at_razorpay' };
  return { match: false, action: 'sync_ours' };
}

/** Razorpay's payments for an order, as one state for our row of `amountPaise`. */
export function paymentStateOf(
  items: {
    status?: string;
    amount?: number | string;
    amount_refunded?: number | string;
  }[],
  amountPaise: number
): RazorpayPaymentState {
  const forAmount = items.filter((p) => Number(p.amount) === amountPaise);
  if (
    forAmount.some(
      (p) =>
        p.status === 'refunded' || Number(p.amount_refunded ?? 0) >= amountPaise
    )
  )
    return 'refunded';
  if (forAmount.some((p) => p.status === 'captured')) return 'captured';
  if (items.some((p) => p.status === 'failed')) return 'failed';
  return 'not_paid';
}
