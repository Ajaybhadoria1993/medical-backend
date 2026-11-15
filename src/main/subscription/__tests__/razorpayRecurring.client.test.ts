import { razorpayClient } from '../gateway/razorpay.client';
import { razorpayInstance } from '../../../utils/razorpay';

jest.mock('../../../utils/razorpay', () => ({
  callRazorpaySdk: (_context: string, fn: () => Promise<unknown>) => fn(),
  razorpayInstance: {
    orders: { create: jest.fn() },
    payments: { createRecurringPayment: jest.fn() },
  },
}));

const createOrder = razorpayInstance.orders.create as jest.Mock;
const recurring = razorpayInstance.payments.createRecurringPayment as jest.Mock;

describe('razorpayClient AutoPay calls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createOrder.mockResolvedValue({
      id: 'order_1',
      amount: 49900,
      currency: 'INR',
      status: 'created',
    });
  });

  it('registers AutoPay with a cap and no fixed schedule', async () => {
    await razorpayClient.createMandateOrder({
      amountPaise: 49900,
      customerId: 'cust_1',
      method: 'upi',
      maxAmountPaise: 99800,
      expireAt: new Date('2036-11-05T00:00:00Z'),
      receipt: 'r1',
      notes: {},
    });
    expect(createOrder.mock.calls[0][0]).toMatchObject({
      customer_id: 'cust_1',
      method: 'upi',
      token: {
        max_amount: 99800,
        expire_at: 2109456000,
        frequency: 'as_presented',
      },
    });
  });

  it('charges a renewal on the saved token after the pre-debit notice', async () => {
    await razorpayClient.createRecurringOrder({
      amountPaise: 59800,
      tokenId: 'token_1',
      chargeAfter: new Date('2026-12-02T00:00:00Z'),
      receipt: 'r2',
      notes: {},
    });
    expect(createOrder.mock.calls[0][0].notification).toEqual({
      token_id: 'token_1',
      payment_after: 1796169600,
    });

    recurring.mockResolvedValue({ razorpay_payment_id: 'pay_1' });
    const res = await razorpayClient.chargeToken({
      orderId: 'order_1',
      customerId: 'cust_1',
      tokenId: 'token_1',
      amountPaise: 59800,
      email: 'a@b.c',
      contact: '9999999999',
      description: 'Clinic renewal',
      notes: {},
    });
    expect(res).toEqual({ paymentId: 'pay_1' });
    expect(recurring.mock.calls[0][0]).toMatchObject({
      token: 'token_1',
      recurring: '1',
      amount: 59800,
    });
  });
});
