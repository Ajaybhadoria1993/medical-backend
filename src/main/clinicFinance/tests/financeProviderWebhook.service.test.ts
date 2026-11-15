import { database } from '../../../configurations/dbConnection';
import { DisputeService } from '../services/dispute.service';
import {
  ClinicFinanceProviderWebhookService,
  mapRazorpayDisputeStatus,
} from '../services/financeProviderWebhook.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../services/dispute.service', () => ({
  DisputeService: { upsertFromProvider: jest.fn() },
}));
jest.mock('../services/settlement.service', () => ({
  SettlementService: { upsertFromProvider: jest.fn() },
}));
jest.mock('../../../utils/razorpay', () => ({
  razorpayInstance: { transfers: { all: jest.fn() } },
  callRazorpaySdk: jest.fn(),
}));

function queryResult(value: unknown) {
  const chain: Record<
    string,
    jest.Mock | ((resolve: (v: unknown) => void) => void)
  > = {};
  for (const method of ['from', 'innerJoin', 'where', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.then = (resolve: (result: unknown) => void) => resolve(value);
  return chain;
}

describe('clinic finance provider webhook mapping', () => {
  it('maps active Razorpay dispute events to under review', () => {
    expect(
      mapRazorpayDisputeStatus('payment.dispute.action_required', {
        status: 'open',
      })
    ).toEqual({
      status: 'UNDER_REVIEW',
      resolutionParty: null,
      resolvedAt: null,
    });
  });

  it('maps won and lost disputes to the correct resolution party', () => {
    const won = mapRazorpayDisputeStatus('payment.dispute.won', {});
    const lost = mapRazorpayDisputeStatus('payment.dispute.lost', {});

    expect(won.status).toBe('RESOLVED_CLINIC');
    expect(won.resolutionParty).toBe('CLINIC');
    expect(won.resolvedAt).toBeInstanceOf(Date);
    expect(lost.status).toBe('RESOLVED_PATIENT');
    expect(lost.resolutionParty).toBe('PATIENT');
    expect(lost.resolvedAt).toBeInstanceOf(Date);
  });

  it('uses deducted amount to resolve a closed dispute', () => {
    expect(
      mapRazorpayDisputeStatus('payment.dispute.closed', {
        amount_deducted: 5000,
      }).status
    ).toBe('RESOLVED_PATIENT');
    expect(
      mapRazorpayDisputeStatus('payment.dispute.closed', {
        amount_deducted: 0,
      }).status
    ).toBe('RESOLVED_CLINIC');
  });

  it('persists a verified Razorpay dispute against its local appointment payment', async () => {
    (database.select as jest.Mock).mockReturnValue(
      queryResult([
        {
          paymentId: 'payment-id',
          appointmentId: 'appointment-id',
          clinicId: 'clinic-id',
        },
      ])
    );

    const handled =
      await ClinicFinanceProviderWebhookService.handleRazorpayWebhook({
        event: 'payment.dispute.created',
        created_at: 1589907977,
        payload: {
          payment: { entity: { id: 'pay_gateway_id' } },
          dispute: {
            entity: {
              id: 'disp_gateway_id',
              payment_id: 'pay_gateway_id',
              amount: 39000,
              reason_code: 'service_not_received',
              status: 'open',
              created_at: 1589907957,
            },
          },
        },
      });

    expect(handled).toBe(true);
    expect(DisputeService.upsertFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-id',
        appointmentId: 'appointment-id',
        appointmentPaymentId: 'payment-id',
        paymentProvider: 'razorpay',
        providerDisputeId: 'disp_gateway_id',
        amount: 390,
        status: 'UNDER_REVIEW',
      })
    );
  });
});
