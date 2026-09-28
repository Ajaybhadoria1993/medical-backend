export interface ICancellationEvaluationResult {
  allowed: boolean;
  reason?: string;
  errorCode?: string;
}

export interface IRefundEvaluationResult {
  eligible: boolean;
  refundType: 'Full' | 'Partial' | 'None';
  refundAmount: number;
}

export interface ICancellationRequestPayload {
  reasonCode: string;
  comments?: string;
  isOverride?: boolean;
}
