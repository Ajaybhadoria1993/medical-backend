import { database } from '../../../configurations/dbConnection';
import { ClinicPaymentAccountModel } from '../../clinic/models/clinicPaymentAccount.model';
import { and, eq } from 'drizzle-orm';
import logger from '../../../utils/logger';
import { envConfig } from '../../../utils/envConfig';

export class PaymentProviderResolver {
  /**
   * Resolves which payment gateway provider and sub-merchant account should process the checkout.
   */
  public static async resolve(
    sourceType: 'APPOINTMENT' | 'SUBSCRIPTION_UPGRADE' | 'ADDON' | string,
    clinicId: string,
    requestedProvider?: string
  ): Promise<{ provider: string; routeAccountId?: string }> {
    const defaultGateway = (
      process.env.DEFAULT_PLATFORM_GATEWAY || 'razorpay'
    ).toLowerCase();
    const targetProvider = (requestedProvider || defaultGateway).toLowerCase();

    // 1. Direct Platform Payments (Subscriptions & Add-ons) -> Central Merchant Gateway
    if (sourceType !== 'APPOINTMENT') {
      return {
        provider: targetProvider,
      };
    }

    // 2. Split Payments (Appointments) -> Match active sub-merchant account for the target paymentProvider
    try {
      const [clinicAccount] = await database
        .select()
        .from(ClinicPaymentAccountModel)
        .where(
          and(
            eq(ClinicPaymentAccountModel.clinicId, clinicId),
            eq(ClinicPaymentAccountModel.paymentProvider, targetProvider),
            eq(ClinicPaymentAccountModel.routeStatus, 'ACTIVE')
          )
        )
        .limit(1);

      if (clinicAccount && clinicAccount.gatewayAccountId) {
        // If provider is Razorpay but ENABLE_RAZORPAY_ROUTE is false, process as regular direct order
        if (
          targetProvider === 'razorpay' &&
          envConfig.ENABLE_RAZORPAY_ROUTE === false
        ) {
          logger.info(
            `Razorpay Route split is disabled via ENABLE_RAZORPAY_ROUTE=false. Processing as regular direct order for clinic ${clinicId}.`
          );
          return {
            provider: 'razorpay',
            routeAccountId: undefined,
          };
        }

        return {
          provider: targetProvider,
          routeAccountId: clinicAccount.gatewayAccountId,
        };
      }
    } catch (err) {
      logger.error('Error resolving clinic payment account:', err);
    }

    // 3. Default fallback (regular payment without route sub-account)
    logger.info(
      `Clinic ${clinicId} has no active split-route account for ${targetProvider}. Falling back to standard direct checkout.`
    );
    return {
      provider: targetProvider,
    };
  }
}
