import type { PayoutState } from '../types/payoutAccounts.types';

const BY_ROUTE_STATUS: Record<string, PayoutState> = {
  DRAFT: 'setting_up',
  PENDING: 'verifying',
  ACTIVE: 'ready',
  NEEDS_CLARIFICATION: 'action_needed',
  REJECTED: 'action_needed',
  SUSPENDED: 'suspended',
};

/** The Route statuses behind each state, so the adapter filters in SQL; not_set_up is "none of these". */
export const KNOWN_ROUTE_STATUSES = Object.keys(BY_ROUTE_STATUS);
export const routeStatusesFor = (state: PayoutState): string[] =>
  KNOWN_ROUTE_STATUSES.filter((s) => BY_ROUTE_STATUS[s] === state);

/** No row, INACTIVE or an unknown status all mean payouts are not set up. */
export const toPayoutState = (routeStatus: string | null): PayoutState =>
  BY_ROUTE_STATUS[String(routeStatus ?? '').toUpperCase()] ?? 'not_set_up';

/** Every state with a zero, so the page can show a chip even when none match. */
export const emptyPayoutCounts = (): Record<PayoutState, number> => ({
  not_set_up: 0,
  setting_up: 0,
  verifying: 0,
  action_needed: 0,
  ready: 0,
  suspended: 0,
});
