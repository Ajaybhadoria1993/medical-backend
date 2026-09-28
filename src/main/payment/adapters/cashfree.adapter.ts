import crypto from 'crypto';
import axios from 'axios';
import {
  IPaymentAdapter,
  IOrderPayload,
  IUnifiedOrderResponse,
  INormalizedPaymentEvent,
  IRefundPayload,
  IRefundResponse,
} from '../interfaces/IPaymentAdapter';
import { IReconciledTransaction } from '../interfaces/reconciliation.types';
import logger from '../../../utils/logger';

export class CashfreeAdapter implements IPaymentAdapter {
  public readonly providerName = 'cashfree';

  private getBaseUrl(): string {
    const env = process.env.CASHFREE_ENV || 'SANDBOX';
    return env.toUpperCase() === 'PRODUCTION'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-client-id': process.env.CASHFREE_APP_ID || '',
      'x-client-secret': process.env.CASHFREE_SECRET_KEY || '',
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create an order on Cashfree (Direct or Easy Split)
   */
  public async createOrder(
    payload: IOrderPayload
  ): Promise<IUnifiedOrderResponse> {
    const url = `${this.getBaseUrl()}/orders`;

    const requestBody: any = {
      order_id: `cf_${payload.receipt}_${Date.now().toString().slice(-6)}`,
      order_amount: payload.amount,
      order_currency: payload.currency || 'INR',
      customer_details: {
        customer_id: payload.notes.patientId || `cust_${Date.now()}`,
        customer_phone: payload.notes.patientPhone || '9999999999',
        customer_email: payload.notes.patientEmail || 'patient@medisetu.com',
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || 'https://medisetu.com'}/payment/callback?order_id={order_id}`,
      },
      order_tags: {
        sourceType: payload.notes.sourceType,
        checkoutReferenceId: payload.notes.checkoutReferenceId,
        clinicId: payload.notes.clinicId,
      },
    };

    // If split transfers exist and it's NOT a direct payment
    if (
      !payload.isDirectPayment &&
      payload.transfers &&
      payload.transfers.length > 0
    ) {
      requestBody.order_splits = payload.transfers.map((t) => ({
        vendor_id: t.account,
        amount: t.amount,
      }));
    }

    try {
      const response = await axios.post(url, requestBody, {
        headers: this.getHeaders(),
      });
      const data = response.data;

      return {
        gatewayOrderId: data.order_id,
        paymentProvider: this.providerName,
        amount: data.order_amount,
        currency: data.order_currency,
        clientSecretOrSdkPayload: {
          orderId: data.order_id,
          paymentSessionId: data.payment_session_id,
        },
        rawResponse: data,
      };
    } catch (err: any) {
      logger.error('Cashfree order creation error', err.response?.data || err);
      throw new Error(
        `Cashfree order creation failed: ${err.response?.data?.message || err.message}`
      );
    }
  }

  /**
   * Cryptographically verify Cashfree webhook signature
   */
  public verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): boolean {
    const signature =
      (headers['x-webhook-signature'] as string) ||
      (headers['X-Webhook-Signature'] as string);
    const timestamp =
      (headers['x-webhook-timestamp'] as string) ||
      (headers['X-Webhook-Timestamp'] as string);

    if (!signature || !timestamp) {
      return false;
    }

    const secret =
      process.env.CASHFREE_WEBHOOK_SECRET ||
      process.env.CASHFREE_SECRET_KEY ||
      '';

    if (!secret) {
      logger.warn('CASHFREE_WEBHOOK_SECRET is not configured.');
      return false;
    }

    try {
      const bodyStr =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const payloadToSign = timestamp + bodyStr;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadToSign)
        .digest('base64');

      return signature === expectedSignature;
    } catch (err) {
      logger.error('Error verifying Cashfree webhook signature', err);
      return false;
    }
  }

  /**
   * Normalize Cashfree webhook payload
   */
  public normalizeWebhookEvent(rawPayload: any): INormalizedPaymentEvent {
    const data = rawPayload.data || {};
    const order = data.order || {};
    const payment = data.payment || {};

    const gatewayOrderId = order.order_id || '';
    const gatewayPaymentId = String(payment.cf_payment_id || '');
    const amount = order.order_amount || payment.payment_amount || 0;
    const paymentStatus = payment.payment_status || '';

    let status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' = 'PENDING';
    if (paymentStatus === 'SUCCESS') {
      status = 'SUCCESS';
    } else if (paymentStatus === 'FAILED' || paymentStatus === 'USER_DROPPED') {
      status = 'FAILED';
    }

    return {
      gatewayOrderId,
      gatewayPaymentId,
      paymentProvider: this.providerName,
      amount,
      status,
      eventType: rawPayload.type || 'CASHFREE_PAYMENT_EVENT',
      rawPayload,
    };
  }

  /**
   * Process refund on Cashfree
   */
  public async processRefund(
    payload: IRefundPayload
  ): Promise<IRefundResponse> {
    const url = `${this.getBaseUrl()}/orders/${payload.gatewayPaymentId}/refunds`;

    try {
      const response = await axios.post(
        url,
        {
          refund_amount: payload.amount,
          refund_id: `rfnd_${Date.now()}`,
          refund_note: payload.notes?.reason || 'Customer requested refund',
        },
        { headers: this.getHeaders() }
      );

      return {
        refundId: response.data.refund_id,
        gatewayPaymentId: payload.gatewayPaymentId,
        amount: response.data.refund_amount,
        status:
          response.data.refund_status === 'SUCCESS' ? 'PROCESSED' : 'PENDING',
        rawResponse: response.data,
      };
    } catch (err: any) {
      logger.error('Cashfree refund failed', err.response?.data || err);
      throw new Error(`Cashfree refund error: ${err.message}`);
    }
  }

  /**
   * Pulls daily reconciliation transactions from Cashfree
   */
  public async getReconciliationReport(
    _date: Date
  ): Promise<IReconciledTransaction[]> {
    return [];
  }
}
