import {
  MAX_WEBHOOK_ATTEMPTS,
  nextRetryDelayMs,
  webhookRef,
} from '../utils/webhookEvent.utils';

const min = (n: number) => n * 60 * 1000;

describe('nextRetryDelayMs', () => {
  it('waits 1, 2, 4 … minutes and never more than an hour', () => {
    expect([1, 2, 3, 4, 7, 8, 9].map(nextRetryDelayMs)).toEqual([
      min(1),
      min(2),
      min(4),
      min(8),
      min(60),
      min(60),
      min(60),
    ]);
  });

  it('stops once the attempts are used up', () => {
    expect(nextRetryDelayMs(MAX_WEBHOOK_ATTEMPTS)).toBeNull();
  });
});

describe('webhookRef', () => {
  it('reads the order and payment of a payment event', () => {
    expect(
      webhookRef('payment.captured', {
        payment: { entity: { id: 'pay_1', order_id: 'order_1' } },
      })
    ).toEqual({ kind: 'payment', orderId: 'order_1', paymentId: 'pay_1' });
  });

  it('reads the payment a refund belongs to', () => {
    expect(
      webhookRef('refund.processed', {
        refund: { entity: { payment_id: 'pay_1' } },
      })
    ).toEqual({ kind: 'refund', paymentId: 'pay_1' });
  });

  it('has no reference for AutoPay, payout-account or order-less payments', () => {
    expect(webhookRef('subscription.charged', {})).toBeNull();
    expect(webhookRef('account.activated', {})).toBeNull();
    expect(
      webhookRef('payment.captured', { payment: { entity: { id: 'pay_1' } } })
    ).toBeNull();
  });
});
