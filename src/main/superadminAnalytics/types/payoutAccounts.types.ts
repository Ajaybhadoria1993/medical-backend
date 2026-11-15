/** A clinic's online payout status in plain terms, from its Razorpay Route status. */
export type PayoutState =
  | 'not_set_up'
  | 'setting_up'
  | 'verifying'
  | 'action_needed'
  | 'ready'
  | 'suspended';

/** One clinic's payout account as the adapter reads it; bank details are masked at the source. */
export interface PayoutAccountFacts {
  clinicId: string;
  clinicCode: string | null;
  clinicName: string;
  routeStatus: string | null;
  reason: string | null;
  bankName: string | null;
  maskedAccount: string | null;
  updatedAt: Date | null;
}

export interface PayoutAccountRow extends Omit<
  PayoutAccountFacts,
  'routeStatus'
> {
  state: PayoutState;
}

/** What the adapter is asked for: one page, a search, and Route statuses to keep or to rule out. */
export interface PayoutAccountsFilter {
  page: number;
  pageSize: number;
  q?: string;
  clinicId?: string;
  /** Keep only these Route statuses. */
  statusIn?: string[];
  /** Keep rows with no status or any status outside these (the "not set up" state). */
  statusNotIn?: string[];
}

/** One page of rows, the total behind it, and Route-status counts for the chips (search applied). */
export interface PayoutAccountsPage {
  rows: PayoutAccountFacts[];
  total: number;
  statusCounts: { routeStatus: string | null; count: number }[];
}

export interface PayoutAccountsResponse {
  counts: Record<PayoutState, number>;
  rows: PayoutAccountRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
