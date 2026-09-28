import { PaymentProviderResolver } from '../services/paymentProviderResolver';
import { PaymentService } from '../services/payment.service';
import { ReconciliationAuditor } from '../services/reconciliationAuditor.service';
import { database } from '../../../configurations/dbConnection';
import { PaymentStrategyFactory } from '../factory/paymentStrategy.factory';
import { ConfigurationResolver } from '../engine/configurationResolver';
import { envConfig } from '../../../utils/envConfig';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../engine/configurationResolver');
jest.mock('../factory/paymentStrategy.factory');

describe('Payment Services & Components Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createSelectChain = (returnValue: any) => {
    const chain: any = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(returnValue);
    chain.orderBy = jest.fn().mockResolvedValue(returnValue);
    return chain;
  };

  const createInsertChain = (returnValue: any) => {
    const chain: any = {};
    chain.values = jest.fn().mockReturnValue(chain);
    chain.returning = jest.fn().mockResolvedValue(returnValue);
    return chain;
  };

  const createUpdateChain = () => {
    const chain: any = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue([]);
    return chain;
  };

  describe('PaymentProviderResolver', () => {
    it('should route non-appointment direct payments to default platform gateway', async () => {
      process.env.DEFAULT_PLATFORM_GATEWAY = 'razorpay';
      const result = await PaymentProviderResolver.resolve(
        'SUBSCRIPTION_UPGRADE',
        'clinic_1'
      );
      expect(result.provider).toBe('razorpay');
      expect(result.routeAccountId).toBeUndefined();
    });

    it('should route non-appointment direct payments to explicitly requested provider if provided', async () => {
      const result = await PaymentProviderResolver.resolve(
        'SUBSCRIPTION_UPGRADE',
        'clinic_1',
        'cashfree'
      );
      expect(result.provider).toBe('cashfree');
      expect(result.routeAccountId).toBeUndefined();
    });

    it('should resolve active sub-merchant account from ClinicPaymentAccountModel for split appointments', async () => {
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            clinicId: 'clinic_1',
            paymentProvider: 'cashfree',
            gatewayAccountId: 'cf_sub_vendor_99',
            routeStatus: 'ACTIVE',
          },
        ])
      );

      const result = await PaymentProviderResolver.resolve(
        'APPOINTMENT',
        'clinic_1',
        'cashfree'
      );
      expect(result.provider).toBe('cashfree');
      expect(result.routeAccountId).toBe('cf_sub_vendor_99');
    });

    it('should bypass Razorpay Route split and return routeAccountId as undefined when ENABLE_RAZORPAY_ROUTE is false', async () => {
      envConfig.ENABLE_RAZORPAY_ROUTE = false;
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            clinicId: 'clinic_1',
            paymentProvider: 'razorpay',
            gatewayAccountId: 'acc_rzp_mock_123',
            routeStatus: 'ACTIVE',
          },
        ])
      );

      const result = await PaymentProviderResolver.resolve(
        'APPOINTMENT',
        'clinic_1'
      );
      expect(result.provider).toBe('razorpay');
      expect(result.routeAccountId).toBeUndefined();
    });

    it('should attach routeAccountId for Razorpay when ENABLE_RAZORPAY_ROUTE is true', async () => {
      envConfig.ENABLE_RAZORPAY_ROUTE = true;
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            clinicId: 'clinic_1',
            paymentProvider: 'razorpay',
            gatewayAccountId: 'acc_rzp_mock_123',
            routeStatus: 'ACTIVE',
          },
        ])
      );

      const result = await PaymentProviderResolver.resolve(
        'APPOINTMENT',
        'clinic_1'
      );
      expect(result.provider).toBe('razorpay');
      expect(result.routeAccountId).toBe('acc_rzp_mock_123');
    });

    it('should fall back to default platform gateway if clinic has no active linked route accounts', async () => {
      process.env.DEFAULT_PLATFORM_GATEWAY = 'razorpay';
      (database.select as jest.Mock).mockReturnValueOnce(createSelectChain([]));

      const result = await PaymentProviderResolver.resolve(
        'APPOINTMENT',
        'clinic_1'
      );
      expect(result.provider).toBe('razorpay');
      expect(result.routeAccountId).toBeUndefined();
    });
  });

  describe('ReconciliationAuditor', () => {
    it('should detect transfer split discrepancies when settled amount differs from recorded transfer amount', async () => {
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            id: 'tx_123',
            gatewayOrderId: 'order_rzp_100',
            transferredAmount: '450.00',
          },
        ])
      );
      (database.update as jest.Mock).mockReturnValue(createUpdateChain());

      const report = [
        {
          gatewayOrderId: 'order_rzp_100',
          gatewayPaymentId: 'pay_100',
          gatewayName: 'razorpay',
          amountCaptured: 500,
          paymentGatewayFee: 10,
          transferredAmount: 400, // Discrepancy! Expected 450
          settlementStatus: 'SETTLED' as const,
        },
      ];

      const auditResult = await ReconciliationAuditor.auditTransactions(report);
      expect(auditResult.audited).toBe(1);
      expect(auditResult.discrepancies).toBe(1);
      expect(database.update).toHaveBeenCalled();
    });

    it('should pass cleanly when settled transfers match local database records', async () => {
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            id: 'tx_123',
            gatewayOrderId: 'order_rzp_100',
            transferredAmount: '450.00',
          },
        ])
      );
      (database.update as jest.Mock).mockReturnValue(createUpdateChain());

      const report = [
        {
          gatewayOrderId: 'order_rzp_100',
          gatewayPaymentId: 'pay_100',
          gatewayName: 'razorpay',
          amountCaptured: 500,
          paymentGatewayFee: 10,
          transferredAmount: 450, // Matches perfectly
          settlementStatus: 'SETTLED' as const,
        },
      ];

      const auditResult = await ReconciliationAuditor.auditTransactions(report);
      expect(auditResult.audited).toBe(1);
      expect(auditResult.discrepancies).toBe(0);
      expect(database.update).not.toHaveBeenCalled();
    });
  });

  describe('PaymentService', () => {
    it('should orchestrate createCheckoutSession: dynamic splits + payment intent + strategy order creation', async () => {
      (ConfigurationResolver.getMergedConfigs as jest.Mock).mockResolvedValue([
        {
          feeName: 'convenience fee',
          feeType: 'CONVENIENCE_FEE',
          enabled: true,
          calculationMethod: 'PERCENTAGE',
          calculationBase: 'CLINIC_SERVICE_PRICE',
          rateOrAmount: 2,
          taxRate: 18,
          taxTreatment: 'TAX_EXCLUSIVE',
          feePayer: 'PATIENT',
          feeRecipient: 'PLATFORM',
          deductionStrategy: 'ADD_TO_PATIENT_TOTAL',
          applicationLevel: 'APPOINTMENT_LEVEL',
          priority: 1,
          effectiveFrom: new Date('2020-01-01'),
          effectiveTo: null,
        },
      ]);

      const mockAdapter = {
        providerName: 'razorpay',
        createOrder: jest.fn().mockResolvedValue({
          gatewayOrderId: 'order_mock_555',
          paymentProvider: 'razorpay',
          amount: 511.8,
          currency: 'INR',
          rawResponse: { id: 'order_mock_555' },
        }),
      };
      (PaymentStrategyFactory.getStrategy as jest.Mock).mockReturnValue(
        mockAdapter
      );

      // Select for sub-merchant account in PaymentProviderResolver
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            clinicId: 'clinic_test',
            paymentProvider: 'razorpay',
            gatewayAccountId: 'acc_route_888',
            routeStatus: 'ACTIVE',
          },
        ])
      );

      // Insert for PaymentIntent and PaymentTransaction
      (database.insert as jest.Mock)
        .mockReturnValueOnce(createInsertChain([{ id: 'intent_uuid_1' }]))
        .mockReturnValueOnce(createInsertChain([{ id: 'tx_uuid_1' }]));

      const checkout = await PaymentService.createCheckoutSession({
        sourceType: 'APPOINTMENT',
        checkoutReferenceId: 'chk_ref_999',
        clinicId: 'clinic_test',
        patientId: 'pat_1',
        basePrice: 500,
      });

      expect(checkout.paymentIntentId).toBe('intent_uuid_1');
      expect(checkout.paymentProvider).toBe('razorpay');
      expect(checkout.order.gatewayOrderId).toBe('order_mock_555');
      expect(checkout.splitDetails.clinicAmount).toBe(500);
      expect(mockAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: checkout.splitDetails.patientTotal,
          transfers: [
            {
              account: 'acc_route_888',
              amount: 500,
              notes: {
                checkoutReferenceId: 'chk_ref_999',
                clinicId: 'clinic_test',
              },
            },
          ],
        })
      );
    });

    it('should mark payment succeeded and update PaymentIntent and PaymentTransaction', async () => {
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            id: 'intent_uuid_1',
            status: 'REQUIRES_PAYMENT',
            checkoutReferenceId: 'chk_ref_999',
          },
        ])
      );
      (database.update as jest.Mock).mockReturnValue(createUpdateChain());

      const res = await PaymentService.markPaymentSucceeded(
        'chk_ref_999',
        'pay_rzp_success_123',
        'appt_real_id_777'
      );

      expect(res.alreadyProcessed).toBe(false);
      expect(database.update).toHaveBeenCalledTimes(2); // Updates intent & transaction
    });

    it('should recognize idempotent duplicate calls when PaymentIntent is already SUCCEEDED', async () => {
      (database.select as jest.Mock).mockReturnValue(
        createSelectChain([
          {
            id: 'intent_uuid_1',
            status: 'SUCCEEDED',
            checkoutReferenceId: 'chk_ref_999',
          },
        ])
      );
      (database.update as jest.Mock).mockReturnValue(createUpdateChain());

      const res = await PaymentService.markPaymentSucceeded(
        'chk_ref_999',
        'pay_rzp_success_123',
        'appt_real_id_777'
      );

      expect(res.alreadyProcessed).toBe(true);
      expect(database.update).not.toHaveBeenCalled();
    });
  });
});
