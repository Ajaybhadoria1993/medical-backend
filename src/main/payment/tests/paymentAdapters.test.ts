import { RazorpayAdapter } from '../adapters/razorpay.adapter';
import * as razorpayUtils from '../../../utils/razorpay';
import crypto from 'crypto';

jest.mock('../../../utils/razorpay');
jest.mock('axios');

describe('Multi-Gateway Adapters Unit Tests', () => {
  describe('RazorpayAdapter', () => {
    let adapter: RazorpayAdapter;

    beforeEach(() => {
      jest.clearAllMocks();
      adapter = new RazorpayAdapter();
      process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
    });

    it('should correctly format order creation with split transfers in paise', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ id: 'order_rzp_123' });
      (razorpayUtils as any).razorpayInstance = {
        orders: { create: mockCreate },
      };
      (razorpayUtils.callRazorpaySdk as jest.Mock).mockImplementation(
        (_name, fn) => fn()
      );

      const payload = {
        amount: 500, // 500 INR -> 50000 paise
        currency: 'INR',
        receipt: 'rec_001',
        notes: {
          sourceType: 'APPOINTMENT',
          checkoutReferenceId: 'chk_123',
          clinicId: 'clinic_abc',
        },
        transfers: [
          {
            account: 'acc_route_999',
            amount: 450, // 450 INR -> 45000 paise
          },
        ],
      };

      const result = await adapter.createOrder(payload);

      expect(result.gatewayOrderId).toBe('order_rzp_123');
      expect(result.paymentProvider).toBe('razorpay');
      expect(result.amount).toBe(500);
      expect(result.clientSecretOrSdkPayload?.amount).toBe(50000);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50000,
          currency: 'INR',
          receipt: 'rec_001',
          payment_capture: 1,
          transfers: [
            {
              account: 'acc_route_999',
              amount: 45000,
              currency: 'INR',
              notes: {},
              on_hold: false,
            },
          ],
        })
      );
    });

    it('should correctly verify Razorpay webhook signatures', () => {
      const secret = 'test_webhook_secret';
      const body = JSON.stringify({ event: 'payment.captured' });
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      const isValid = adapter.verifyWebhookSignature(body, {
        'x-razorpay-signature': validSignature,
      });
      expect(isValid).toBe(true);

      const isInvalid = adapter.verifyWebhookSignature(body, {
        'x-razorpay-signature': 'invalid_sig',
      });
      expect(isInvalid).toBe(false);
    });

    it('should normalize Razorpay webhook payload into unified event structure', () => {
      const samplePayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_999',
              order_id: 'order_111',
              amount: 55000, // in paise
            },
          },
        },
      };

      const normalized = adapter.normalizeWebhookEvent(samplePayload);
      expect(normalized.gatewayOrderId).toBe('order_111');
      expect(normalized.gatewayPaymentId).toBe('pay_999');
      expect(normalized.paymentProvider).toBe('razorpay');
      expect(normalized.amount).toBe(550);
      expect(normalized.status).toBe('SUCCESS');
    });

    it('should process refunds on Razorpay with reverse_all_transfers when requested', async () => {
      const mockRefund = jest.fn().mockResolvedValue({
        id: 'rfnd_rzp_1',
        status: 'processed',
      });
      (razorpayUtils as any).razorpayInstance = {
        payments: { refund: mockRefund },
      };
      (razorpayUtils.callRazorpaySdk as jest.Mock).mockImplementation(
        (_name, fn) => fn()
      );

      const res = await adapter.processRefund({
        gatewayPaymentId: 'pay_999',
        amount: 500,
        reverseAllTransfers: true,
      });

      expect(res.refundId).toBe('rfnd_rzp_1');
      expect(res.status).toBe('PROCESSED');
      expect(mockRefund).toHaveBeenCalledWith('pay_999', {
        amount: 50000,
        notes: {},
        reverse_all_transfers: 1,
      });
    });
  });
});
