import { FinancialLedgerModel } from '../../appointments/models/financialLedger.model';
import { ISplitEngineResult } from '../interfaces/splitEngine.types';

export interface ILogPaymentInput {
  appointmentId: string;
  clinicId: string;
  paymentId: string;
  gatewayPaymentId: string;
  gatewayName: string;
  splits: ISplitEngineResult;
  extraTelemetry?: Record<string, any>;
}

export class FinancialLedgerService {
  /**
   * Log transaction breakdown atomically inside Postgres database transactions
   */
  public static async logPaymentCaptured(
    tx: any,
    input: ILogPaymentInput
  ): Promise<void> {
    const {
      appointmentId,
      clinicId,
      paymentId,
      gatewayPaymentId,
      gatewayName,
      splits,
      extraTelemetry,
    } = input;

    const commonMeta = {
      gatewayName,
      breakdown: splits.breakdown,
      ...(extraTelemetry || {}),
    };

    const ledgerEntries: any[] = [];

    // 1. Payment Received from patient (total inflow)
    ledgerEntries.push({
      appointmentId,
      clinicId,
      paymentId,
      entryType: 'PAYMENT_RECEIVED',
      amount: String(splits.patientTotal),
      description: 'Patient payment captured',
      gatewayReferenceId: gatewayPaymentId,
      metaData: commonMeta,
      createdAt: new Date(),
    });

    // 2. Platform Commission & Convenience Fee retained (revenue)
    if (splits.platformAmount > 0) {
      ledgerEntries.push({
        appointmentId,
        clinicId,
        paymentId,
        entryType: 'PLATFORM_COMMISSION',
        amount: String(-splits.platformAmount),
        description: 'Platform commission & fee retained',
        gatewayReferenceId: gatewayPaymentId,
        metaData: commonMeta,
        createdAt: new Date(),
      });
    }

    // 3. Payout routed to Clinic (sub-account transfer)
    if (splits.clinicAmount > 0) {
      ledgerEntries.push({
        appointmentId,
        clinicId,
        paymentId,
        entryType: 'TRANSFER_CREATED',
        amount: String(-splits.clinicAmount),
        description: 'Clinic service payout routed',
        gatewayReferenceId: gatewayPaymentId,
        metaData: commonMeta,
        createdAt: new Date(),
      });
    }

    // 4. GST collected
    if (splits.taxAmount > 0) {
      ledgerEntries.push({
        appointmentId,
        clinicId,
        paymentId,
        entryType: 'GST',
        amount: String(-splits.taxAmount),
        description: 'GST tax collected on platform fee',
        gatewayReferenceId: gatewayPaymentId,
        metaData: commonMeta,
        createdAt: new Date(),
      });
    }

    if (ledgerEntries.length > 0) {
      await tx.insert(FinancialLedgerModel).values(ledgerEntries);
    }
  }
}
