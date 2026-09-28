import { RazorpayAdapter } from '../adapters/razorpay.adapter';
import { CashfreeAdapter } from '../adapters/cashfree.adapter';
import * as razorpayUtils from '../../../utils/razorpay';
import axios from 'axios';
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

  describe('CashfreeAdapter', () => {
    let adapter: CashfreeAdapter;

    beforeEach(() => {
      jest.clearAllMocks();
      adapter = new CashfreeAdapter();
      process.env.CASHFREE_APP_ID = 'test_app_id';
      process.env.CASHFREE_SECRET_KEY = 'test_secret_key';
      process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret';
      process.env.CASHFREE_ENV = 'SANDBOX';
    });

    it('should correctly format Cashfree order creation with Easy Split order_splits', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          order_id: 'cf_rec_001_123456',
          order_amount: 600,
          order_currency: 'INR',
          payment_session_id: 'session_cf_123',
        },
      });

      const payload = {
        amount: 600,
        currency: 'INR',
        receipt: 'rec_001',
        notes: {
          sourceType: 'APPOINTMENT',
          checkoutReferenceId: 'chk_456',
          clinicId: 'clinic_xyz',
          patientPhone: '9876543210',
          patientEmail: 'test@medisetu.com',
        },
        transfers: [
          {
            account: 'vendor_clinic_1',
            amount: 550,
          },
        ],
      };

      const result = await adapter.createOrder(payload);

      expect(result.gatewayOrderId).toBe('cf_rec_001_123456');
      expect(result.paymentProvider).toBe('cashfree');
      expect(result.amount).toBe(600);
      expect(result.clientSecretOrSdkPayload?.paymentSessionId).toBe(
        'session_cf_123'
      );

      expect(axios.post).toHaveBeenCalledWith(
        'https://sandbox.cashfree.com/pg/orders',
        expect.objectContaining({
          order_amount: 600,
          order_currency: 'INR',
          customer_details: {
            customer_id: expect.any(String),
            customer_phone: '9876543210',
            customer_email: 'test@medisetu.com',
          },
          order_splits: [
            {
              vendor_id: 'vendor_clinic_1',
              amount: 550,
            },
          ],
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-client-id': 'test_app_id',
            'x-client-secret': 'test_secret_key',
            'x-api-version': '2023-08-01',
          }),
        })
      );
    });

    it('should verify Cashfree webhook signature using HMAC base64 with timestamp header', () => {
      const timestamp = String(Date.now());
      const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' });
      const secret = 'test_webhook_secret';
      const payloadToSign = timestamp + body;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadToSign)
        .digest('base64');

      const isValid = adapter.verifyWebhookSignature(body, {
        'x-webhook-signature': expectedSignature,
        'x-webhook-timestamp': timestamp,
      });

      expect(isValid).toBe(true);

      const isInvalid = adapter.verifyWebhookSignature(body, {
        'x-webhook-signature': 'wrong_signature',
        'x-webhook-timestamp': timestamp,
      });

      expect(isInvalid).toBe(false);
    });

    it('should normalize Cashfree webhook payload into unified event structure', () => {
      const cfPayload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: {
            order_id: 'cf_order_777',
            order_amount: 750,
          },
          payment: {
            cf_payment_id: 1234567,
            payment_status: 'SUCCESS',
            payment_amount: 750,
          },
        },
      };

      const normalized = adapter.normalizeWebhookEvent(cfPayload);
      expect(normalized.gatewayOrderId).toBe('cf_order_777');
      expect(normalized.gatewayPaymentId).toBe('1234567');
      expect(normalized.paymentProvider).toBe('cashfree');
      expect(normalized.amount).toBe(750);
      expect(normalized.status).toBe('SUCCESS');
    });

    it('should process refunds on Cashfree', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          refund_id: 'rfnd_cf_01',
          refund_amount: 300,
          refund_status: 'SUCCESS',
        },
      });

      const res = await adapter.processRefund({
        gatewayPaymentId: 'order_123',
        amount: 300,
        notes: { reason: 'Consultation cancelled' },
      });

      expect(res.refundId).toBe('rfnd_cf_01');
      expect(res.amount).toBe(300);
      expect(res.status).toBe('PROCESSED');
    });
  });
});
