import { capturedFor } from '../utils/reconcile.utils';

describe('capturedFor', () => {
  const items = [
    { id: 'pay_f', status: 'failed', amount: 99900 },
    { id: 'pay_p', status: 'captured', amount: 50000 },
    { id: 'pay_ok', status: 'captured', amount: '99900', method: 'upi' },
  ];

  it('picks the captured payment for the full amount', () => {
    expect(capturedFor(items, 99900)?.id).toBe('pay_ok');
  });

  it('ignores failed and wrong-amount payments', () => {
    expect(capturedFor(items.slice(0, 2), 99900)).toBeNull();
  });
});
