import { database } from '../../../configurations/dbConnection';
import { razorpayClient } from '../gateway/razorpay.client';
import { PaymentsService } from '../services/billing/payments.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { transaction: jest.fn(), update: jest.fn() },
}));
jest.mock('../../../utils/logger');
jest.mock('../gateway/razorpay.client', () => ({
  razorpayClient: {
    // Not yet refunded at Razorpay, so the refund is sent.
    fetchPayment: jest.fn().mockResolvedValue({ status: 'captured' }),
    refundPayment: jest.fn(),
  },
}));
jest.mock('../services/billing/invoice.service', () => ({
  InvoiceService: { issue: jest.fn().mockResolvedValue({ id: 'inv-1' }) },
}));
jest.mock('../services/limitation.service', () => ({
  FEATURE_KEYS: {
    DOCTOR_ACCOUNTS: 'doctor_accounts',
    STAFF_ACCOUNTS: 'staff_accounts',
  },
  LimitationService: {
    invalidateClinicCache: jest.fn(),
    reactivateStaffOnUpgrade: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../services/subscriptionActivity.service', () => ({
  SubscriptionActivityService: { record: jest.fn() },
}));
jest.mock('../notify/subscriptionNotify', () => ({
  subscriptionNotify: jest.fn(),
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin', 'for', 'set', 'returning'])
    q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};

const row = {
  id: 'pay-row-1',
  ownerType: 'clinic',
  ownerId: 'clinic-1',
  kind: 'addon_purchase',
  status: 'created',
  subscriptionId: 'sub-1',
  amountPaise: 9950,
  discountPaise: 0,
  couponId: null,
  currency: 'INR',
  providerOrderId: 'order_1',
  providerPaymentId: null,
  provider: 'razorpay',
  periodStart: new Date('2026-11-30T00:00:00Z'),
  periodEnd: new Date('2026-12-15T00:00:00Z'),
  lines: {
    version: 1,
    items: [
      {
        kind: 'addon',
        description: 'Extra doctor × 1',
        amountPaise: 9950,
        addOnId: 'doctor',
        quantity: 1,
        billingCycle: 'monthly',
      },
    ],
  },
};
const current = (id: string) => ({
  id,
  status: 'active',
  isTrial: false,
  currentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
  billingAnchorDay: 15,
  planKind: 'paid',
});

function fakeTx(currentId: string) {
  const inserted: unknown[] = [];
  const updates: unknown[] = [];
  const tx = {
    select: jest
      .fn()
      .mockReturnValueOnce(rowsOf([row]))
      .mockReturnValueOnce(rowsOf([current(currentId)])),
    insert: () => ({
      values: (v: unknown) => {
        inserted.push(v);
        return {
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          returning: () => rowsOf([v]),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return rowsOf([{ ...row, ...v }]);
      },
    }),
  };
  (database.transaction as jest.Mock).mockImplementation((fn) => fn(tx));
  return { inserted, updates };
}

describe('activatePayment for add-ons', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds the bought quantity to the current subscription, without touching its period', async () => {
    const { inserted, updates } = fakeTx('sub-1');
    const out = await PaymentsService.activatePayment({
      paymentRowId: 'pay-row-1',
      providerPaymentId: 'pay_A',
    });

    expect(out.kind).toBe('applied');
    expect(inserted).toEqual([
      expect.objectContaining({
        subscriptionId: 'sub-1',
        addOnId: 'doctor',
        quantity: 1,
      }),
    ]);
    // Only the payment row is updated: the subscription keeps its period.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      status: 'captured',
      providerPaymentId: 'pay_A',
    });
  });

  it('refunds a purchase priced on a plan that has since changed', async () => {
    (database.update as jest.Mock).mockReturnValue(rowsOf([]));
    const { inserted } = fakeTx('sub-2');
    const out = await PaymentsService.activatePayment({
      paymentRowId: 'pay-row-1',
      providerPaymentId: 'pay_A',
    });

    expect(out.kind).toBe('duplicate');
    expect(inserted).toEqual([]);
    expect(razorpayClient.refundPayment).toHaveBeenCalledWith(
      'pay_A',
      expect.any(Object)
    );
  });
});
