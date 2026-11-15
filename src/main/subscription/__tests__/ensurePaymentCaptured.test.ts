import { ensurePaymentCaptured } from '../utils/razorpayOrder.utils';
import { razorpayInstance } from '../../../utils/razorpay';

jest.mock('../../../utils/razorpay', () => ({
  callRazorpaySdk: (_context: string, fn: () => Promise<unknown>) => fn(),
  razorpayInstance: {
    payments: {
      fetch: jest.fn(),
      capture: jest.fn(),
    },
  },
}));

const fetchMock = razorpayInstance.payments.fetch as jest.Mock;
const captureMock = razorpayInstance.payments.capture as jest.Mock;

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay_1',
  order_id: 'order_1',
  amount: 49900,
  currency: 'INR',
  method: 'upi',
  status: 'captured',
  ...overrides,
});

describe('ensurePaymentCaptured', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a captured payment without capturing again', async () => {
    fetchMock.mockResolvedValueOnce(payment());

    const result = await ensurePaymentCaptured({
      paymentId: 'pay_1',
      orderId: 'order_1',
      minAmount: 499,
      captureIfAuthorized: true,
    });

    expect(result.status).toBe('captured');
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('rejects an authorized payment when capture is not allowed', async () => {
    fetchMock.mockResolvedValueOnce(payment({ status: 'authorized' }));

    await expect(
      ensurePaymentCaptured({ paymentId: 'pay_1' })
    ).rejects.toMatchObject({ status: 409 });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures an authorized order payment for its full amount', async () => {
    fetchMock.mockResolvedValueOnce(payment({ status: 'authorized' }));
    captureMock.mockResolvedValueOnce(payment());

    const result = await ensurePaymentCaptured({
      paymentId: 'pay_1',
      orderId: 'order_1',
      captureIfAuthorized: true,
    });

    expect(captureMock).toHaveBeenCalledWith('pay_1', 49900, 'INR');
    expect(result.status).toBe('captured');
  });

  it('accepts a capture that lost the race to a webhook or auto-capture', async () => {
    fetchMock
      .mockResolvedValueOnce(payment({ status: 'authorized' }))
      .mockResolvedValueOnce(payment());
    captureMock.mockRejectedValueOnce(new Error('already captured'));

    const result = await ensurePaymentCaptured({
      paymentId: 'pay_1',
      captureIfAuthorized: true,
    });

    expect(result.status).toBe('captured');
  });

  it('rethrows a failed capture when the payment is still not captured', async () => {
    fetchMock
      .mockResolvedValueOnce(payment({ status: 'authorized' }))
      .mockResolvedValueOnce(payment({ status: 'authorized' }));
    captureMock.mockRejectedValueOnce(new Error('capture failed'));

    await expect(
      ensurePaymentCaptured({ paymentId: 'pay_1', captureIfAuthorized: true })
    ).rejects.toThrow('capture failed');
  });

  it('rejects failed payments', async () => {
    fetchMock.mockResolvedValueOnce(payment({ status: 'failed' }));

    await expect(
      ensurePaymentCaptured({ paymentId: 'pay_1', captureIfAuthorized: true })
    ).rejects.toMatchObject({ status: 409 });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('rejects a payment that belongs to a different order', async () => {
    fetchMock.mockResolvedValueOnce(payment({ order_id: 'order_other' }));

    await expect(
      ensurePaymentCaptured({ paymentId: 'pay_1', orderId: 'order_1' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a captured amount below the purchase price', async () => {
    fetchMock.mockResolvedValueOnce(payment({ amount: 10000 }));

    await expect(
      ensurePaymentCaptured({ paymentId: 'pay_1', minAmount: 499 })
    ).rejects.toMatchObject({ status: 400 });
  });
});
