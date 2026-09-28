import { IReconciledTransaction } from './reconciliation.types';

export interface ITransferSplit {
  account: string; // Sub-merchant linked account ID
  amount: number; // in Rupees (will be converted to paise in adapter if gateway requires it)
  currency?: string;
  notes?: Record<string, any>;
}

export interface IOrderPayload {
  amount: number; // in Rupees
  currency?: string;
  receipt: string; // e.g. apt_123 or sub_456
  notes: {
    sourceType: 'APPOINTMENT' | 'SUBSCRIPTION_UPGRADE' | 'ADDON' | string;
    checkoutReferenceId: string;
    clinicId: string;
    patientId?: string;
    [key: string]: any;
  };
  isDirectPayment?: boolean; // If true, ignore transfers and credit platform merchant account 100%
  transfers?: ITransferSplit[];
}

export interface IUnifiedOrderResponse {
  gatewayOrderId: string;
  paymentProvider: string;
  amount: number; // in Rupees
  currency: string;
  clientSecretOrSdkPayload?: Record<string, any>;
  rawResponse?: any;
}

export interface INormalizedPaymentEvent {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  paymentProvider: string;
  amount: number; // in Rupees
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED';
  eventType: string; // e.g. 'payment.captured', 'order.paid'
  transferId?: string;
  rawPayload: any;
}

export interface IRefundPayload {
  gatewayPaymentId: string;
  amount: number; // in Rupees
  reverseAllTransfers?: boolean;
  notes?: Record<string, any>;
}

export interface IRefundResponse {
  refundId: string;
  gatewayPaymentId: string;
  amount: number;
  status: 'PROCESSED' | 'PENDING' | 'FAILED';
  rawResponse?: any;
}

/**
 * Universal Payment Gateway Adapter Interface
 */
export interface IPaymentAdapter {
  readonly providerName: string;

  /**
   * Create an order on the payment gateway (split route or direct merchant).
   */
  createOrder(payload: IOrderPayload): Promise<IUnifiedOrderResponse>;

  /**
   * Cryptographically verify an incoming webhook request from the payment gateway.
   */
  verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): boolean;

  /**
   * Normalize gateway-specific webhook events into a unified structure.
   */
  normalizeWebhookEvent(rawPayload: any): INormalizedPaymentEvent;

  /**
   * Process a refund back to patient/customer.
   */
  processRefund(payload: IRefundPayload): Promise<IRefundResponse>;

  /**
   * Retrieve daily settlement and transaction reconciliation reports.
   */
  getReconciliationReport(date: Date): Promise<IReconciledTransaction[]>;
}
