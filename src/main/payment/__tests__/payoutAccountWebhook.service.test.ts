import { database } from '../../../configurations/dbConnection';
import { fetchRazorpayRouteAccountProducts } from '../../../utils/razorpay';
import { PayoutAccountWebhookService as Hook } from '../services/payoutAccount/payoutAccountWebhook.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), update: jest.fn() },
}));
jest.mock('../../../utils/razorpay', () => ({
  fetchRazorpayRouteAccountProducts: jest.fn(),
}));
jest.mock('../../../utils/logger');
jest.mock('../services/payoutAccount/payoutAccountStatus.service', () => ({
  PayoutAccountStatusService: { syncClinicBankHistory: jest.fn() },
}));

// The stored row the handler reads, and every update it makes.
const db = database as unknown as { select: jest.Mock; update: jest.Mock };
const fetchProduct = fetchRazorpayRouteAccountProducts as jest.Mock;
let updates: Record<string, unknown>[] = [];
const stored = (status: string, productId: string | null = 'acc_prd_1') => {
  db.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit: async () => [{ status, productId }] }),
    }),
  });
};
beforeEach(() => {
  updates = [];
  jest.clearAllMocks();
  db.update.mockReturnValue({
    set: (v: Record<string, unknown>) => {
      updates.push(v);
      return { where: async () => undefined };
    },
  });
});

const account = (status?: string, requirements?: unknown) => ({
  account: { entity: { id: 'acc_1', status, requirements } },
});
const product = (name = 'route') => ({
  product: {
    entity: { id: 'acc_prd_1', account_id: 'acc_1', product_name: name },
  },
});

describe('PayoutAccountWebhookService', () => {
  it('account activated is PENDING, not ACTIVE (Route not live yet)', async () => {
    stored('INACTIVE');
    await Hook.handle('account.activated', account());
    expect(updates[0]).toMatchObject({ routeStatus: 'PENDING' });
  });

  it('a late account activated never pushes an ACTIVE clinic back to PENDING', async () => {
    stored('ACTIVE');
    await Hook.handle('account.activated', account());
    expect(updates).toHaveLength(0);
  });

  it('Route activated sets ACTIVE only after Razorpay confirms it', async () => {
    stored('PENDING');
    fetchProduct.mockResolvedValue({ activation_status: 'activated' });
    await Hook.handle('product.route.activated', product());
    expect(updates[0]).toMatchObject({ routeStatus: 'ACTIVE' });
  });

  it('going ACTIVE erases the stored form; other statuses keep it for a retry', async () => {
    stored('PENDING');
    fetchProduct.mockResolvedValue({ activation_status: 'activated' });
    await Hook.handle('product.route.activated', product());
    expect(updates[0]).toMatchObject({ onboardingDraftData: null });

    updates = [];
    stored('INACTIVE');
    await Hook.handle('account.activated', account());
    expect(updates[0]).not.toHaveProperty('onboardingDraftData');
  });

  it('both Route event names are handled', async () => {
    stored('PENDING');
    fetchProduct.mockResolvedValue({ activation_status: 'activated' });
    await Hook.handle('product.activated', product());
    expect(updates[0]).toMatchObject({ routeStatus: 'ACTIVE' });
  });

  it('Razorpay saying "not active yet" keeps the status', async () => {
    stored('PENDING');
    fetchProduct.mockResolvedValue({ activation_status: 'under_review' });
    await Hook.handle('product.activated', product());
    expect(updates).toHaveLength(0);
  });

  it('a failed Razorpay check keeps the status', async () => {
    stored('PENDING');
    fetchProduct.mockRejectedValue(new Error('network'));
    await Hook.handle('product.activated', product());
    expect(updates).toHaveLength(0);
  });

  it('the same event twice changes nothing the second time', async () => {
    stored('ACTIVE');
    fetchProduct.mockResolvedValue({ activation_status: 'activated' });
    await Hook.handle('product.activated', product());
    expect(updates).toHaveLength(0);
    expect(fetchProduct).not.toHaveBeenCalled();
  });

  it("rejected and needs clarification keep Razorpay's reason", async () => {
    stored('PENDING');
    await Hook.handle(
      'account.updated',
      account('needs_clarification', [
        { field_reference: 'settlements.ifsc_code', description: 'invalid' },
      ])
    );
    expect(updates[0]).toMatchObject({
      routeStatus: 'NEEDS_CLARIFICATION',
      routeOnboardingRejectionReason: 'bank IFSC code: invalid',
    });
    stored('PENDING');
    await Hook.handle('product.route.rejected', product());
    expect(updates[1]).toMatchObject({ routeStatus: 'REJECTED' });
  });

  it('suspended overrides ACTIVE', async () => {
    stored('ACTIVE');
    await Hook.handle('account.suspended', account());
    expect(updates[0]).toMatchObject({ routeStatus: 'SUSPENDED' });
  });

  it('events about another product or unknown accounts are ignored', async () => {
    stored('PENDING');
    await Hook.handle('product.activated', product('payment_gateway'));
    expect(updates).toHaveLength(0);
    db.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });
    await Hook.handle('account.suspended', account());
    expect(updates).toHaveLength(0);
  });

  describe('Check Status Now (refresh)', () => {
    // One stored row serves both reads: the refresh lookup and the handler's own.
    const row = (status: string) =>
      db.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                accountId: 'acc_1',
                productId: 'acc_prd_1',
                status,
                clinicId: 'c1',
              },
            ],
          }),
        }),
      });

    it('Razorpay says activated: becomes ACTIVE through the webhook path', async () => {
      row('PENDING');
      fetchProduct.mockResolvedValue({ activation_status: 'activated' });
      await Hook.refresh('c1');
      expect(updates[0]).toMatchObject({
        routeStatus: 'ACTIVE',
        onboardingDraftData: null,
      });
    });

    it('still under review: nothing changes', async () => {
      row('PENDING');
      fetchProduct.mockResolvedValue({ activation_status: 'under_review' });
      await Hook.refresh('c1');
      expect(updates).toHaveLength(0);
    });

    it("needs clarification keeps Razorpay's reason", async () => {
      row('PENDING');
      fetchProduct.mockResolvedValue({
        activation_status: 'needs_clarification',
        requirements: [],
      });
      await Hook.refresh('c1');
      expect(updates[0]).toMatchObject({ routeStatus: 'NEEDS_CLARIFICATION' });
    });

    it('Razorpay\'s "Max retry exceeded" lock becomes one plain sentence', async () => {
      row('PENDING');
      fetchProduct.mockResolvedValue({
        activation_status: 'needs_clarification',
        requirements: [
          {
            field_reference: 'settlements.ifsc_code',
            description: 'Max retry exceeded for bank account details.',
          },
        ],
      });
      await Hook.refresh('c1');
      expect(updates[0]).toMatchObject({
        routeStatus: 'NEEDS_CLARIFICATION',
        routeOnboardingRejectionReason: expect.stringContaining(
          'stopped checking new bank details'
        ),
      });
    });
  });
});
