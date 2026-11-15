import {
  emptyPayoutCounts,
  KNOWN_ROUTE_STATUSES,
  routeStatusesFor,
  toPayoutState,
} from '../utils/payoutState.utils';

describe('toPayoutState', () => {
  it('maps every Razorpay Route status to a plain state', () => {
    expect(toPayoutState('DRAFT')).toBe('setting_up');
    expect(toPayoutState('PENDING')).toBe('verifying');
    expect(toPayoutState('ACTIVE')).toBe('ready');
    expect(toPayoutState('NEEDS_CLARIFICATION')).toBe('action_needed');
    expect(toPayoutState('REJECTED')).toBe('action_needed');
    expect(toPayoutState('SUSPENDED')).toBe('suspended');
  });

  it('treats no account, INACTIVE and unknown values as not set up', () => {
    expect(toPayoutState(null)).toBe('not_set_up');
    expect(toPayoutState('INACTIVE')).toBe('not_set_up');
    expect(toPayoutState('something_new')).toBe('not_set_up');
    expect(toPayoutState('active')).toBe('ready');
  });

  it('gives the SQL filter the Route statuses behind each state', () => {
    expect(routeStatusesFor('action_needed').sort()).toEqual([
      'NEEDS_CLARIFICATION',
      'REJECTED',
    ]);
    expect(routeStatusesFor('ready')).toEqual(['ACTIVE']);
    expect(routeStatusesFor('not_set_up')).toEqual([]);
    for (const s of KNOWN_ROUTE_STATUSES)
      expect(toPayoutState(s)).not.toBe('not_set_up');
  });

  it('starts every state at zero', () => {
    expect(Object.values(emptyPayoutCounts()).every((n) => n === 0)).toBe(true);
    expect(Object.keys(emptyPayoutCounts())).toHaveLength(6);
  });
});
