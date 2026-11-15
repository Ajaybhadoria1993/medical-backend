import {
  compareMandate,
  comparePayment,
  paymentStateOf,
} from '../utils/razorpayLive.utils';

describe('Razorpay live check', () => {
  it("reads one state per payment row from the order's Razorpay payments", () => {
    expect(paymentStateOf([{ status: 'captured', amount: 99900 }], 99900)).toBe(
      'captured'
    );
    expect(paymentStateOf([{ status: 'refunded', amount: 99900 }], 99900)).toBe(
      'refunded'
    );
    expect(paymentStateOf([{ status: 'failed', amount: 99900 }], 99900)).toBe(
      'failed'
    );
    expect(paymentStateOf([], 99900)).toBe('not_paid');
    // A capture for another amount is not this row's money.
    expect(paymentStateOf([{ status: 'captured', amount: 100 }], 99900)).toBe(
      'not_paid'
    );
  });

  it('asks to apply a payment Razorpay captured that we never applied', () => {
    expect(comparePayment('pending', 'captured')).toEqual({
      match: false,
      action: 'apply',
    });
    expect(comparePayment('abandoned', 'captured')).toEqual({
      match: false,
      action: 'apply',
    });
    expect(comparePayment('captured', 'captured')).toEqual({
      match: true,
      action: null,
    });
  });

  it('flags a refund made outside the app without trying to fix it', () => {
    expect(comparePayment('captured', 'refunded')).toEqual({
      match: false,
      action: null,
    });
    expect(comparePayment('refunded', 'refunded')).toEqual({
      match: true,
      action: null,
    });
  });

  it('treats any unpaid state of ours as matching when Razorpay holds no money', () => {
    expect(comparePayment('abandoned', 'not_paid').match).toBe(true);
    expect(comparePayment('failed', 'failed').match).toBe(true);
    expect(comparePayment('captured', 'not_paid').match).toBe(false);
  });

  it('does not report a difference when Razorpay could not be asked', () => {
    expect(comparePayment('pending', 'unknown').match).toBe(true);
  });

  it("compares AutoPay status with the state Razorpay's token maps to", () => {
    expect(compareMandate('active', 'active').match).toBe(true);
    expect(compareMandate('active', 'cancelled').match).toBe(false);
    expect(compareMandate('active', null).match).toBe(true);
  });

  it('never turns AutoPay back on: off here but live at Razorpay means cancel it at Razorpay', () => {
    expect(compareMandate('cancelled', 'active')).toEqual({
      match: false,
      action: 'cancel_at_razorpay',
    });
    // Approved at Razorpay but we missed the webhook: ours follows Razorpay.
    expect(compareMandate('pending', 'active')).toEqual({
      match: false,
      action: 'sync_ours',
    });
    expect(compareMandate('active', 'cancelled')).toEqual({
      match: false,
      action: 'sync_ours',
    });
  });

  it('does not list the AutoPay ₹1 check, which Razorpay refunds on its own', () => {
    expect(comparePayment('captured', 'refunded', 'mandate_setup').match).toBe(
      true
    );
    expect(comparePayment('captured', 'refunded', 'renewal').match).toBe(false);
  });
});
