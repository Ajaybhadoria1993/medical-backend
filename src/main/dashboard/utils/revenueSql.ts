import { sql } from 'drizzle-orm';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';

const P = AppointmentPaymentModel;

/**
 * Money the clinic actually received on one payment row — the rule Payments History
 * applies. "Already Paid" settled the base fee elsewhere, so only added services count.
 */
export const RECEIVED_AMOUNT = sql`CASE
  WHEN LOWER(${P.paymentStatus}) = 'paid' THEN ${P.price}::numeric
  WHEN LOWER(${P.paymentStatus}) = 'refunded' THEN
    ${P.price}::numeric - COALESCE(${P.refundedAmount}::numeric, ${P.price}::numeric)
  WHEN LOWER(${P.paymentStatus}) = 'already paid' THEN
    GREATEST(${P.price}::numeric - COALESCE(${P.primaryServicePrice}::numeric, ${P.price}::numeric), 0)
  ELSE 0
END`;

/** Payment rows that can carry received money; pair with `RECEIVED_AMOUNT`. */
export const HAS_RECEIVED_MONEY = sql`LOWER(${P.paymentStatus}) IN ('paid', 'refunded', 'already paid')`;
