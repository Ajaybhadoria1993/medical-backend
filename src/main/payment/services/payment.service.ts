import { database } from '../../../configurations/dbConnection';
import { PaymentIntentModel } from '../models/paymentIntent.model';
import { PaymentTransactionModel } from '../models/paymentTransaction.model';
import { PaymentStrategyFactory } from '../factory/paymentStrategy.factory';
import { PaymentProviderResolver } from './paymentProviderResolver';
import { ConfigurationResolver } from '../engine/configurationResolver';
import { DynamicSplitEngine } from '../engine/dynamicSplit.engine';
import { ISplitEngineResult } from '../interfaces/splitEngine.types';
import { IUnifiedOrderResponse } from '../interfaces/IPaymentAdapter';
import { eq, and } from 'drizzle-orm';
import logger from '../../../utils/logger';

export interface ICreateCheckoutSessionInput {
  sourceType: 'APPOINTMENT' | 'SUBSCRIPTION_UPGRADE' | 'ADDON' | string;
  checkoutReferenceId: string;
  clinicId: string;
  patientId?: string;
  patientPhone?: string;
  patientEmail?: string;
  basePrice: number; // in Rupees
  requestedProvider?: string;
}

export interface ICheckoutSessionResult {
  order: IUnifiedOrderResponse;
  splitDetails: ISplitEngineResult;
  paymentIntentId: string;
  paymentProvider: string;
}

export class PaymentService {
  /**
   * Initializes a checkout session: creates/fetches PaymentIntent, computes dynamic splits, and creates the gateway order.
   */
  public static async createCheckoutSession(
    input: ICreateCheckoutSessionInput
  ): Promise<ICheckoutSessionResult> {
    const {
      sourceType,
      checkoutReferenceId,
      clinicId,
      patientId,
      patientPhone,
      patientEmail,
      basePrice,
      requestedProvider,
    } = input;

    // 1. Resolve active provider and sub-merchant account
    const { provider, routeAccountId } = await PaymentProviderResolver.resolve(
      sourceType,
      clinicId,
      requestedProvider
    );

    // 2. Resolve active dynamic fee rules (clinic-override with global fallback)
    const feeConfigs = await ConfigurationResolver.getMergedConfigs(clinicId);

    // 3. Compute dynamic split breakdown using integer Paise math
    const splitDetails = DynamicSplitEngine.calculate(basePrice, feeConfigs);

    // 4. Create or reuse PaymentIntent (Idempotency Guard)
    let paymentIntent: any = null;

    try {
      const [newIntent] = await database
        .insert(PaymentIntentModel)
        .values({
          clinicId,
          sourceType,
          checkoutReferenceId,
          amount: String(splitDetails.patientTotal),
          status: 'REQUIRES_PAYMENT',
          financialSnapshot: {
            breakdown: splitDetails.breakdown,
            feeConfigs,
          },
        })
        .returning();
      paymentIntent = newIntent;
    } catch (err: any) {
      // If intent already exists (e.g. retry / double-click), fetch existing
      const [existingIntent] = await database
        .select()
        .from(PaymentIntentModel)
        .where(
          and(
            eq(PaymentIntentModel.sourceType, sourceType),
            eq(PaymentIntentModel.checkoutReferenceId, checkoutReferenceId)
          )
        )
        .limit(1);

      if (existingIntent) {
        paymentIntent = existingIntent;
      } else {
        throw err;
      }
    }

    // 5. Get concrete gateway strategy
    const adapter = PaymentStrategyFactory.getStrategy(provider);

    // 6. Build transfer array if routeAccountId exists and it is not direct payment
    const transfers = routeAccountId
      ? [
          {
            account: routeAccountId,
            amount: splitDetails.clinicAmount,
            notes: { checkoutReferenceId, clinicId },
          },
        ]
      : undefined;

    // 7. Create Gateway Order
    const order = await adapter.createOrder({
      amount: splitDetails.patientTotal,
      currency: 'INR',
      receipt: checkoutReferenceId.slice(0, 40),
      notes: {
        sourceType,
        checkoutReferenceId,
        clinicId,
        patientId,
        patientPhone,
        patientEmail,
      },
      isDirectPayment: sourceType !== 'APPOINTMENT',
      transfers,
    });

    // 8. Log the payment attempt transaction
    try {
      await database.insert(PaymentTransactionModel).values({
        paymentIntentId: paymentIntent.id,
        paymentMode: 'ONLINE',
        paymentMethod: 'UPI', // Default method, updated post-payment
        paymentProvider: provider,
        paymentStatus: 'Pending',
        price: String(splitDetails.patientTotal),
        gatewayOrderId: order.gatewayOrderId,
        platformCommission: String(splitDetails.platformAmount),
        pgFee: String(splitDetails.gatewayAmount),
        gstAmount: String(splitDetails.taxAmount),
        convenienceFee: String(splitDetails.breakdown.convenienceFee),
        transferredAmount: String(splitDetails.clinicAmount),
        gatewayResponse: order.rawResponse || null,
      });
    } catch (txErr) {
      logger.error('Failed to log payment transaction record', txErr);
    }

    return {
      order,
      splitDetails,
      paymentIntentId: paymentIntent.id,
      paymentProvider: provider,
    };
  }

  /**
   * Finalizes a payment upon success: updates PaymentIntent and PaymentTransaction.
   */
  public static async markPaymentSucceeded(
    checkoutReferenceId: string,
    gatewayPaymentId: string,
    realEntityId: string,
    extraTelemetry?: Record<string, any>
  ): Promise<{ alreadyProcessed: boolean; paymentIntent?: any }> {
    const [intent] = await database
      .select()
      .from(PaymentIntentModel)
      .where(eq(PaymentIntentModel.checkoutReferenceId, checkoutReferenceId))
      .limit(1);

    if (!intent) {
      logger.warn(
        `No PaymentIntent found for checkoutReferenceId: ${checkoutReferenceId}`
      );
      return { alreadyProcessed: false };
    }

    if (intent.status === 'SUCCEEDED') {
      return { alreadyProcessed: true, paymentIntent: intent };
    }

    // Update Intent
    await database
      .update(PaymentIntentModel)
      .set({
        status: 'SUCCEEDED',
        sourceId: realEntityId,
        updatedAt: new Date(),
      })
      .where(eq(PaymentIntentModel.id, intent.id));

    // Update latest transaction for this intent
    await database
      .update(PaymentTransactionModel)
      .set({
        paymentStatus: 'Paid',
        transactionId: gatewayPaymentId,
        gatewayResponse: extraTelemetry || null,
        updatedAt: new Date(),
      })
      .where(eq(PaymentTransactionModel.paymentIntentId, intent.id));

    return { alreadyProcessed: false, paymentIntent: intent };
  }
}
