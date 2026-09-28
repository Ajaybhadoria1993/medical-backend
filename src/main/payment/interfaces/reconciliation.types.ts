export interface IReconciledTransaction {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewayName: string;
  amountCaptured: number;
  paymentGatewayFee: number;
  transferredAmount: number;
  settlementStatus: 'SETTLED' | 'PENDING' | 'FAILED';
  settledAt?: Date;
  rawRecord?: any;
}
