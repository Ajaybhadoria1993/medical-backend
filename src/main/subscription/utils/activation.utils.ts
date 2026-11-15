export type ActivationOutcome =
  'apply' | 'already_applied' | 'duplicate' | 'not_open';

const OPEN = new Set(['created', 'pending', 'abandoned']);
const DONE = new Set(['captured', 'refunded']);

/** An abandoned checkout paid later still applies, unless `conflict`: what it paid for is already in place. */
export function activationOutcome(
  row: { status: string; providerPaymentId: string | null },
  incomingPaymentId: string | null,
  conflict: boolean
): ActivationOutcome {
  if (DONE.has(row.status)) {
    // The same payment can be reported more than once; a different one is a second charge.
    return row.providerPaymentId === incomingPaymentId
      ? 'already_applied'
      : 'duplicate';
  }
  if (!OPEN.has(row.status)) return 'not_open';
  return conflict ? 'duplicate' : 'apply';
}
