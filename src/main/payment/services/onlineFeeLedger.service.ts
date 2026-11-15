import {
  feeJournalLines,
  MoneyWriteService,
  SYSTEM_ACTOR_ID,
  toPaise,
  type FeePart,
} from '../../money';
import logger from '../../../utils/logger';
import type { ISplitBreakdown } from '../interfaces/splitEngine.types';

type Tx = Parameters<typeof MoneyWriteService.post>[0];

export interface OnlineFeeInput {
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
  appointmentId: string;
  /** Razorpay payment id; keys the journal so a webhook resend writes nothing. */
  paymentId: string;
  /** The booking's fee breakdown (rupees), saved as appointment_payments.financial_snapshot. */
  snapshot: ISplitBreakdown | null | undefined;
}

/** The one writer of an online payment's fees into the money ledger. */
export class OnlineFeeLedger {
  /** Books the fees as one journal in the caller's transaction; a booking without a snapshot is skipped. */
  static async record(tx: Tx, input: OnlineFeeInput) {
    if (!input.snapshot) {
      logger.warn(
        `[OnlineFeeLedger] No fee snapshot for appointment ${input.appointmentId}; fees not booked`
      );
      return [];
    }
    const lines = feeJournalLines(this.parts(input.snapshot));
    if (!lines.length) return [];
    return MoneyWriteService.post(tx, {
      clinicId: input.clinicId,
      patientId: input.patientId,
      doctorId: input.doctorId ?? null,
      sourceType: 'appointment',
      sourceId: input.appointmentId,
      entryType: 'payment',
      channel: 'online',
      paymentMode: 'Online',
      gatewayRef: input.paymentId,
      requestId: `razorpay:fees:${input.paymentId}`,
      createdBy: SYSTEM_ACTOR_ID,
      lines,
    });
  }

  /** Every fee is added to the patient's total today, so each is patient-paid. */
  private static parts(b: ISplitBreakdown): FeePart[] {
    const p = (...rupees: number[]) =>
      toPaise(rupees.reduce((n, r) => n + (Number(r) || 0), 0));
    return [
      {
        account: 'convenience_fee',
        amountPaise: p(b.convenienceFee),
        paidBy: 'patient',
      },
      {
        account: 'platform_commission',
        amountPaise: p(b.commission),
        paidBy: 'patient',
      },
      {
        account: 'gst_on_platform_fees',
        amountPaise: p(b.gstOnConvenienceFee, b.gstOnCommission),
        paidBy: 'patient',
      },
      {
        account: 'pg_fee',
        amountPaise: p(b.gatewayFee, b.gstOnGatewayFee),
        paidBy: 'patient',
      },
      {
        account: 'route_fee',
        amountPaise: p(b.routeTransferFee, b.gstOnRouteTransferFee),
        paidBy: 'patient',
      },
      {
        account: 'clinic_output_gst',
        amountPaise: p(b.gstOnPrice),
        paidBy: 'patient',
      },
    ];
  }
}
