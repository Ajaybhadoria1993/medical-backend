import { database } from '../../../configurations/dbConnection';
import { PaymentTransactionModel } from '../models/paymentTransaction.model';
import { IReconciledTransaction } from '../interfaces/reconciliation.types';
import { eq } from 'drizzle-orm';
import logger from '../../../utils/logger';

export class ReconciliationAuditor {
  /**
   * Audits daily settlement report transactions against database payment transactions.
   */
  public static async auditTransactions(
    transactions: IReconciledTransaction[]
  ): Promise<{ audited: number; discrepancies: number }> {
    let discrepancies = 0;

    for (const tx of transactions) {
      try {
        const [localTx] = await database
          .select()
          .from(PaymentTransactionModel)
          .where(eq(PaymentTransactionModel.gatewayOrderId, tx.gatewayOrderId))
          .limit(1);

        if (!localTx) {
          logger.warn(
            `Reconciliation Alert: No local transaction found for Gateway Order ID: ${tx.gatewayOrderId}`
          );
          continue;
        }

        // Check for transfer split discrepancies
        const expectedTransferred = Number(localTx.transferredAmount || 0);
        const actualTransferred = tx.transferredAmount;

        if (
          actualTransferred > 0 &&
          Math.abs(expectedTransferred - actualTransferred) > 0.01
        ) {
          discrepancies++;
          logger.error(
            `Reconciliation Split Discrepancy! Order: ${tx.gatewayOrderId}, Expected: ${expectedTransferred}, Settled: ${actualTransferred}`
          );
          await database
            .update(PaymentTransactionModel)
            .set({
              refundNotes: `Audit Alert: Split mismatch. Expected: ${expectedTransferred}, Settled: ${actualTransferred}`,
            })
            .where(eq(PaymentTransactionModel.id, localTx.id));
        }
      } catch (err) {
        logger.error(
          `Failed to audit transaction for order ${tx.gatewayOrderId}`,
          err
        );
      }
    }

    return {
      audited: transactions.length,
      discrepancies,
    };
  }
}
