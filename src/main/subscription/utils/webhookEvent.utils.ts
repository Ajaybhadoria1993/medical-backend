export const MAX_WEBHOOK_ATTEMPTS = 10;
const MINUTE = 60 * 1000;

/** 1, 2, 4 … minutes, capped at an hour; null once the attempts are used up. */
export const nextRetryDelayMs = (attempts: number): number | null =>
  attempts >= MAX_WEBHOOK_ATTEMPTS
    ? null
    : Math.min(60, 2 ** Math.max(0, attempts - 1)) * MINUTE;

export type WebhookRef =
  | { kind: 'payment'; orderId: string; paymentId: string }
  | { kind: 'refund'; paymentId: string };

type Payload = {
  payment?: { entity?: { id?: string; order_id?: string } };
  refund?: { entity?: { payment_id?: string } };
};

/** The order or payment an event is about; null for events no checkout row can own. */
export function webhookRef(event: string, payload: Payload): WebhookRef | null {
  if (event.startsWith('payment.')) {
    const p = payload.payment?.entity;
    return p?.id && p.order_id
      ? { kind: 'payment', orderId: p.order_id, paymentId: p.id }
      : null;
  }
  if (event.startsWith('refund.')) {
    const paymentId = payload.refund?.entity?.payment_id;
    return paymentId ? { kind: 'refund', paymentId } : null;
  }
  return null;
}
