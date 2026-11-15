import { database } from '../../../configurations/dbConnection';
import { razorpayClient } from '../gateway/razorpay.client';
import { AutoPayRenewalService } from '../services/billing/autoPayRenewal.service';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), update: jest.fn() },
}));
jest.mock('../../../utils/logger');
jest.mock('../gateway/razorpay.client', () => ({
  razorpayClient: { chargeToken: jest.fn() },
}));
jest.mock('../ports', () => ({
  getClinicPort: () => ({
    getOwnerContact: async () => ({ email: 'a@b.c', phone: '9999999999' }),
  }),
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const renewal = {
  id: 'pay-1',
  ownerId: 'clinic-1',
  kind: 'renewal',
  status: 'created',
  providerOrderId: 'order_1',
  mandateId: 'm-1',
  amountPaise: 99900,
  createdAt: new Date(Date.now() - 27 * 60 * 60 * 1000),
};
const mandate = {
  id: 'm-1',
  status: 'active',
  providerCustomerId: 'cust_1',
  providerTokenId: 'token_1',
};

describe('AutoPay renewal waits for the pre-debit notice', () => {
  let updates: unknown[];
  beforeEach(() => {
    jest.resetAllMocks();
    updates = [];
    (database.select as jest.Mock)
      .mockReturnValueOnce(rowsOf([renewal]))
      .mockReturnValueOnce(rowsOf([mandate]));
    (database.update as jest.Mock).mockImplementation(() => ({
      set: (v: unknown) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }));
  });

  it('leaves the renewal waiting when Razorpay has not sent the notice yet', async () => {
    (razorpayClient.chargeToken as jest.Mock).mockRejectedValue(
      new HttpError(
        400,
        'Razorpay recurring charge failed: The payment request failed as the pre-debit notification was not sent to the customer'
      )
    );
    await expect(
      AutoPayRenewalService.chargeAfterNotice('pay-1')
    ).resolves.toBe('waiting');
    expect(updates).toEqual([]);
  });

  it('charges once the notice is out and marks the renewal pending', async () => {
    (razorpayClient.chargeToken as jest.Mock).mockResolvedValue({
      paymentId: 'pay_rzp_1',
    });
    await expect(
      AutoPayRenewalService.chargeAfterNotice('pay-1')
    ).resolves.toBe('charged');
    expect(updates[0]).toMatchObject({
      status: 'pending',
      providerPaymentId: 'pay_rzp_1',
    });
  });

  it('waits until 26 h after the notice before charging', async () => {
    (database.select as jest.Mock)
      .mockReset()
      .mockReturnValueOnce(rowsOf([{ ...renewal, createdAt: new Date() }]))
      .mockReturnValueOnce(rowsOf([mandate]));
    await expect(
      AutoPayRenewalService.chargeAfterNotice('pay-1')
    ).resolves.toBe('waiting');
    expect(razorpayClient.chargeToken).not.toHaveBeenCalled();
  });

  it('charges nothing if AutoPay was turned off after the notice', async () => {
    (database.select as jest.Mock)
      .mockReset()
      .mockReturnValueOnce(rowsOf([renewal]))
      .mockReturnValueOnce(rowsOf([{ ...mandate, status: 'cancelled' }]));
    await expect(
      AutoPayRenewalService.chargeAfterNotice('pay-1')
    ).resolves.toBe('skipped');
    expect(razorpayClient.chargeToken).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: 'abandoned' });
  });
});
