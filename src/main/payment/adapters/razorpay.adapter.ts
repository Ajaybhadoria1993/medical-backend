import crypto from 'crypto';
import {
  IPaymentAdapter,
  IOrderPayload,
  IUnifiedOrderResponse,
  INormalizedPaymentEvent,
  IRefundPayload,
  IRefundResponse,
} from '../interfaces/IPaymentAdapter';
import { IReconciledTransaction } from '../interfaces/reconciliation.types';
import { razorpayInstance, callRazorpaySdk } from '../../../utils/razorpay';
import { envConfig } from '../../../utils/envConfig';
import logger from '../../../utils/logger';

export class RazorpayAdapter implements IPaymentAdapter {
  public readonly providerName = 'razorpay';

  /**
   * Creates a split or direct order on Razorpay.
   */
  public async createOrder(
    payload: IOrderPayload
  ): Promise<IUnifiedOrderResponse> {
    const totalPaise = Math.round(payload.amount * 100);

    const orderOptions: any = {
      amount: totalPaise,
      currency: payload.currency || 'INR',
      receipt: payload.receipt,
      payment_capture: 1,
      notes: payload.notes,
    };

    // If split transfers exist and it's NOT a direct platform payment
    if (
      !payload.isDirectPayment &&
      payload.transfers &&
      payload.transfers.length > 0
    ) {
      orderOptions.transfers = payload.transfers.map((t) => ({
        account: t.account,
        amount: Math.round(t.amount * 100), // convert to paise
        currency: t.currency || 'INR',
        notes: t.notes || {},
        on_hold: false,
      }));
    }

    logger.info(
      `[RazorpayAdapter] Creating Razorpay order: ${JSON.stringify(orderOptions)}`
    );

    const order = await callRazorpaySdk('Razorpay Order Creation', () =>
      razorpayInstance.orders.create(orderOptions)
    );

    return {
      gatewayOrderId: order.id,
      paymentProvider: this.providerName,
      amount: payload.amount,
      currency: payload.currency || 'INR',
      clientSecretOrSdkPayload: {
        orderId: order.id,
        keyId: envConfig.RAZORPAY_KEY_ID,
        amount: totalPaise,
        currency: payload.currency || 'INR',
      },
      rawResponse: order,
    };
  }

  /**
   * Cryptographically verifies Razorpay webhook signature.
   */
  public verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): boolean {
    const signature =
      (headers['x-razorpay-signature'] as string) ||
      (headers['X-Razorpay-Signature'] as string);

    if (!signature) {
      return false;
    }

    const secret =
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      envConfig.RAZORPAY_WEBHOOK_SECRET ||
      '';

    if (!secret) {
      logger.warn('RAZORPAY_WEBHOOK_SECRET is not configured.');
      return false;
    }

    try {
      const bodyStr =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(bodyStr)
        .digest('hex');

      const bufExpected = Buffer.from(expectedSignature, 'utf8');
      const bufActual = Buffer.from(signature, 'utf8');
      if (bufExpected.length !== bufActual.length) {
        return false;
      }
      return crypto.timingSafeEqual(bufExpected, bufActual);
    } catch (err) {
      logger.error('Error verifying Razorpay webhook signature', err);
      return false;
    }
  }

  /**
   * Normalizes Razorpay webhook payload into a standardized event.
   */
  public normalizeWebhookEvent(rawPayload: any): INormalizedPaymentEvent {
    const event = rawPayload.event || '';
    const paymentEntity = rawPayload.payload?.payment?.entity || {};
    const orderEntity = rawPayload.payload?.order?.entity || {};

    const gatewayOrderId =
      paymentEntity.order_id || orderEntity.id || rawPayload.order_id || '';
    const gatewayPaymentId = paymentEntity.id || rawPayload.payment_id || '';
    const amountInRupees =
      (paymentEntity.amount || orderEntity.amount || 0) / 100;

    let status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' = 'PENDING';
    if (event === 'payment.captured' || event === 'order.paid') {
      status = 'SUCCESS';
    } else if (event === 'payment.failed') {
      status = 'FAILED';
    } else if (event === 'refund.processed') {
      status = 'REFUNDED';
    }

    return {
      gatewayOrderId,
      gatewayPaymentId,
      paymentProvider: this.providerName,
      amount: amountInRupees,
      status,
      eventType: event,
      rawPayload,
    };
  }

  /**
   * Process refund on Razorpay.
   */
  public async processRefund(
    payload: IRefundPayload
  ): Promise<IRefundResponse> {
    const refundOptions: any = {
      amount: Math.round(payload.amount * 100),
      notes: payload.notes || {},
    };

    if (payload.reverseAllTransfers) {
      refundOptions.reverse_all_transfers = 1;
    }

    const refund = await callRazorpaySdk('Razorpay Refund', () =>
      razorpayInstance.payments.refund(payload.gatewayPaymentId, refundOptions)
    );

    return {
      refundId: refund.id,
      gatewayPaymentId: payload.gatewayPaymentId,
      amount: payload.amount,
      status: refund.status === 'processed' ? 'PROCESSED' : 'PENDING',
      rawResponse: refund,
    };
  }

  /**
   * Pulls daily reconciliation transactions from Razorpay.
   */
  public async getReconciliationReport(
    date: Date
  ): Promise<IReconciledTransaction[]> {
    try {
      const fromTimestamp = Math.floor(
        new Date(date.setHours(0, 0, 0, 0)).getTime() / 1000
      );
      const toTimestamp = Math.floor(
        new Date(date.setHours(23, 59, 59, 999)).getTime() / 1000
      );

      const payments = await callRazorpaySdk('Razorpay Fetch Payments', () =>
        razorpayInstance.payments.all({
          from: fromTimestamp,
          to: toTimestamp,
          count: 100,
        })
      );

      return (payments.items || []).map((item: any) => ({
        gatewayOrderId: item.order_id,
        gatewayPaymentId: item.id,
        gatewayName: this.providerName,
        amountCaptured: item.amount / 100,
        paymentGatewayFee: (item.fee || 0) / 100,
        transferredAmount: 0, // Resolved from transfers if present
        settlementStatus:
          item.status === 'captured'
            ? 'SETTLED'
            : item.status === 'failed'
              ? 'FAILED'
              : 'PENDING',
        settledAt: item.created_at
          ? new Date(item.created_at * 1000)
          : undefined,
        rawRecord: item,
      }));
    } catch (err) {
      logger.error('Failed to pull Razorpay reconciliation report', err);
      return [];
    }
  }
}
