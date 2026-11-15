import { getSourceDataPort } from '../ports';
import type { PayoutAccountsQueryDto } from '../schemas/payoutAccounts.schema';
import type { PayoutAccountsResponse } from '../types/payoutAccounts.types';
import {
  emptyPayoutCounts,
  KNOWN_ROUTE_STATUSES,
  routeStatusesFor,
  toPayoutState,
} from '../utils/payoutState.utils';

export class PayoutAccountsService {
  /** One page of clinics' payout status; state, search and paging run in SQL, not here. */
  static async list(
    query: PayoutAccountsQueryDto
  ): Promise<PayoutAccountsResponse> {
    const { page, pageSize, state, q, clinicId } = query;
    const result = await getSourceDataPort().getPayoutAccounts({
      page,
      pageSize,
      q,
      clinicId,
      // "Not set up" is every status outside the known ones, so it is a NOT IN.
      ...(state === 'not_set_up'
        ? { statusNotIn: KNOWN_ROUTE_STATUSES }
        : state
          ? { statusIn: routeStatusesFor(state) }
          : {}),
    });

    const counts = emptyPayoutCounts();
    for (const c of result.statusCounts)
      counts[toPayoutState(c.routeStatus)] += c.count;

    return {
      counts,
      rows: result.rows.map(({ routeStatus, ...r }) => ({
        ...r,
        state: toPayoutState(routeStatus),
      })),
      page,
      pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }
}
