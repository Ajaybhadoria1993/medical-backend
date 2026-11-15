/** A clinic's Razorpay Route status, as stored in clinic_payment_accounts.route_status. */
export type RouteStatus =
  | 'INACTIVE'
  | 'PENDING'
  | 'ACTIVE'
  | 'NEEDS_CLARIFICATION'
  | 'REJECTED'
  | 'SUSPENDED';

/** Webhooks arrive out of order: a late "account activated" must not push an ACTIVE clinic back to PENDING. */
export function canMoveRouteStatus(from: string, to: RouteStatus): boolean {
  if (from === to) return false;
  return !(from === 'ACTIVE' && to === 'PENDING');
}
