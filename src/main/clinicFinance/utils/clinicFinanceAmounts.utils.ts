import { SQL, sql } from 'drizzle-orm';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';

export const patientPlatformFeeExpression = (): SQL => sql`
  COALESCE(
    NULLIF((${AppointmentPaymentModel.financialSnapshot} ->> 'commission')::numeric, 0),
    NULLIF((${AppointmentPaymentModel.financialSnapshot} -> 'breakdown' ->> 'commission')::numeric, 0),
    COALESCE(${AppointmentPaymentModel.platformCommission}::numeric, 0)
  )
`;

export const bookedPaymentCondition = (): SQL => sql`
  LOWER(COALESCE(${AppointmentPaymentModel.paymentStatus}, ''))
    IN ('paid', 'pending', 'credit', 'refunded')
`;

export const isOnlinePaymentCondition = (): SQL => sql`
  (LOWER(COALESCE(${AppointmentPaymentModel.paymentMode}, '')) IN ('razorpay', 'online', 'payment gateway', 'card online', 'netbanking', 'gateway', 'cashfree')
  OR ${AppointmentPaymentModel.gatewayOrderId} IS NOT NULL)
`;

export const isOfflinePaymentCondition = (): SQL => sql`
  NOT (LOWER(COALESCE(${AppointmentPaymentModel.paymentMode}, '')) IN ('razorpay', 'online', 'payment gateway', 'card online', 'netbanking', 'gateway', 'cashfree')
  OR ${AppointmentPaymentModel.gatewayOrderId} IS NOT NULL)
`;

export function money(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
