import { sql } from 'drizzle-orm';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { appointmentMultipleService } from '../../appointments/models/appointmentMultipleService.model';
import { visitMoneySql } from '../../money/utils/visitMoneySql';

const P = AppointmentPaymentModel;
const S = appointmentMultipleService;

/** Added services on the row's visit; the add-service form takes Cash/UPI/Card only, so they are paid on the spot. */
const ADDON_TOTAL = sql`COALESCE(
  (SELECT SUM(${S.price}::numeric) FROM ${S} WHERE ${S.appointmentId} = ${P.appointmentId}), 0)`;

/** "Already Paid": the consultation was covered by an earlier visit, so only add-ons are this visit's money. */
const COVERED_VISIT = sql`LOWER(${P.paymentStatus}) = 'already paid'`;

/** Clinic's money on a payment row: primary + added services, never an online checkout's fee/GST.
 *  A row without `primaryServicePrice` holds it all in `price`; a covered visit counts its add-ons only. */
export const CLINIC_AMOUNT = sql`CASE
  WHEN ${COVERED_VISIT} THEN ${ADDON_TOTAL}
  WHEN ${P.primaryServicePrice} IS NULL THEN COALESCE(${P.price}::numeric, 0)
  ELSE ${P.primaryServicePrice}::numeric + ${ADDON_TOTAL}
END`;

/** The visit's payment state says money was taken (bill state; money itself is in money_entries). */
export const HAS_RECEIVED_MONEY = sql`(LOWER(${P.paymentStatus}) IN ('paid', 'refunded', 'partly paid', 'partly refunded')
  OR (${COVERED_VISIT} AND EXISTS (SELECT 1 FROM ${S} WHERE ${S.appointmentId} = ${P.appointmentId})))`;

/** How the row's money was paid: the visit's own mode, else its first add-on's (a covered visit has none of its own). */
export const PAYMENT_MODE = sql`COALESCE(NULLIF(TRIM(${P.paymentMode}), ''), (
  SELECT NULLIF(TRIM(${S.paymentMode}), '') FROM ${S}
  WHERE ${S.appointmentId} = ${P.appointmentId} AND NULLIF(TRIM(${S.paymentMode}), '') IS NOT NULL
  ORDER BY ${S.createdAt} LIMIT 1))`;

/** `CLINIC_AMOUNT` split into Payments History lines; the two must always sum the same. */
export function clinicAmountLines(
  primaryServicePrice: string | number | null | undefined,
  price: string | number | null | undefined,
  addedPrices: number[]
) {
  const added = addedPrices.reduce((sum, p) => sum + p, 0);
  const primary =
    primaryServicePrice == null || primaryServicePrice === ''
      ? (Number(price) || 0) - added
      : Number(primaryServicePrice) || 0;
  return { primary, total: primary + added };
}

/** What the visit still owes: its bill less the money received on it (a part payment lowers it). */
export const DUE_AMOUNT = sql`GREATEST(${CLINIC_AMOUNT} - ${visitMoneySql(P.appointmentId)}, 0)`;
