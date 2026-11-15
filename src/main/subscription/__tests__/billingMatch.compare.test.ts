import { BillingMatchService } from '../services/billing/billingMatch.service';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../utils/logger');

const row = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'r1',
    kind: 'plan_purchase',
    status: 'captured',
    amountPaise: 99900,
    needsRefund: false,
    ...extra,
  }) as never;
const rzp = (status: string, amount = 99900) => ({
  id: 'pay_1',
  order_id: 'order_1',
  status,
  amount,
});

describe('Billing match: one payment vs Razorpay', () => {
  it('matches when both say captured for the same amount', () => {
    expect(BillingMatchService.compare(row(), rzp('captured'))).toBeNull();
  });
  it('flags money Razorpay captured that we never applied', () => {
    expect(
      BillingMatchService.compare(row({ status: 'abandoned' }), rzp('captured'))
        ?.kind
    ).toBe('not_applied');
  });
  it('flags a different captured amount', () => {
    expect(
      BillingMatchService.compare(row(), rzp('captured', 49900))?.kind
    ).toBe('amount_differs');
  });
  it('flags a payment we applied that Razorpay refunded', () => {
    expect(BillingMatchService.compare(row(), rzp('refunded'))?.kind).toBe(
      'state_differs'
    );
  });
  it('ignores a failed try on the same order, but flags our own payment failing', () => {
    expect(
      BillingMatchService.compare(
        row({ providerPaymentId: 'pay_2' }),
        rzp('failed')
      )
    ).toBeNull();
    expect(
      BillingMatchService.compare(
        row({ providerPaymentId: 'pay_1' }),
        rzp('failed')
      )?.kind
    ).toBe('state_differs');
  });
  it('does not flag the AutoPay ₹1 check or an owed duplicate being refunded', () => {
    expect(
      BillingMatchService.compare(
        row({ kind: 'mandate_setup', amountPaise: 100 }),
        rzp('refunded', 100)
      )
    ).toBeNull();
    expect(
      BillingMatchService.compare(row({ needsRefund: true }), rzp('refunded'))
    ).toBeNull();
  });
});
