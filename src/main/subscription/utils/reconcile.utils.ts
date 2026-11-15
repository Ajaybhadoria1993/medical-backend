type GatewayPayment = {
  id: string;
  status: string;
  amount: number | string;
  method?: string;
};

/** The captured payment for the full amount, if the clinic paid; a partial or wrong amount needs a human. */
export function capturedFor(payments: GatewayPayment[], amountPaise: number) {
  return (
    payments.find(
      (p) => p.status === 'captured' && Number(p.amount) === amountPaise
    ) ?? null
  );
}

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
