import { ClinicFinanceProviderWebhookService as Webhook } from '../services/financeProviderWebhook.service';
import { notify } from '../../notifications/queues/notification.queue';

let stored: unknown[] = [];
const rows = () => [
  [
    {
      paymentId: 'p1',
      appointmentId: 'a1',
      transfersData: stored,
      clinicId: 'c1',
    },
  ],
  [{ clinicId: 'c1' }],
];
let reads: unknown[][] = [];
const chain = (): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const k of ['from', 'innerJoin', 'where']) c[k] = () => c;
  c.limit = async () => reads.shift();
  return c;
};

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => chain(),
    update: () => ({
      set: (v: { transfersData: unknown[] }) => ({
        where: async () => {
          stored = v.transfersData;
        },
      }),
    }),
  },
}));
jest.mock('../../notifications/queues/notification.queue', () => ({
  notify: jest.fn(),
}));
jest.mock('../../../utils/razorpay', () => ({
  razorpayInstance: {},
  callRazorpaySdk: jest.fn(),
}));
jest.mock('../services/dispute.service', () => ({ DisputeService: {} }));
jest.mock('../services/settlement.service', () => ({ SettlementService: {} }));

const send = (event: string, at: number) => {
  reads = rows();
  return Webhook.handleRazorpayWebhook({
    event,
    created_at: at,
    payload: {
      transfer: {
        entity: {
          id: 'trf_1',
          source: 'pay_1',
          recipient: 'acc_1',
          amount: 120000,
          failure_reason: 'Bank account closed',
        },
      },
    },
  });
};

beforeEach(() => {
  stored = [];
  jest.clearAllMocks();
});

describe('payout failed alert', () => {
  it('alerts once for a failed transfer, even when Razorpay retries', async () => {
    await send('transfer.failed', 100);
    await send('transfer.failed', 100);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'payment.transfer_failed',
      expect.objectContaining({
        clinicId: 'c1',
        appointmentId: 'a1',
        amount: '1,200.00',
        reversed: false,
        reason: 'Bank account closed',
      }),
      { jobId: 'payment.transfer_failed|trf_1|transfer.failed' }
    );
  });

  it('says nothing for a transfer that went through', async () => {
    await send('transfer.processed', 100);
    expect(notify).not.toHaveBeenCalled();
  });

  it('alerts again when a paid transfer is later reversed', async () => {
    await send('transfer.processed', 100);
    await send('transfer.reversed', 200);
    expect(notify).toHaveBeenCalledWith(
      'payment.transfer_failed',
      expect.objectContaining({ reversed: true }),
      expect.anything()
    );
  });
});
