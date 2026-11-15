// DeliveryService: cost on billable reports, a single give-back on failed or not-billable ones.
const selectLimit = jest.fn();
const updateWhere = jest.fn();
const updateSet = jest.fn((_values: unknown) => ({ where: updateWhere }));
const txReturning = jest.fn();
const txGrantWhere = jest.fn();
const txSet = jest.fn();
const transaction = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => selectLimit() }) }),
    }),
    update: () => ({ set: (values: unknown) => updateSet(values) }),
    transaction: (cb: (tx: unknown) => unknown) => transaction(cb),
  },
}));

const warn = jest.fn();
const logError = jest.fn();
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => logError(...args),
    info: jest.fn(),
  },
}));

jest.mock('../services/core/settings.service', () => ({
  CreditSettingsService: {
    getInForce: async () => ({ unitCostInr: '0.1150', taxPercent: '18.00' }),
  },
}));

import { recordDeliveryStatus } from '..';

const report = (status: string, billable?: boolean) => ({
  messageId: 'wamid.1',
  status,
  billable,
});

beforeEach(() => {
  jest.clearAllMocks();
  selectLimit.mockResolvedValue([{ channel: 'whatsapp', refundedAt: null }]);
  updateWhere.mockResolvedValue(undefined);
  // The refund transaction: first update returns the refunded row, second adjusts the grant.
  transaction.mockImplementation(async (cb) =>
    cb({
      update: () => ({
        set: (values: unknown) => {
          txSet(values);
          return {
            where: (cond: unknown) => ({
              returning: () => txReturning(cond),
              then: (resolve: (v: unknown) => void) =>
                resolve(txGrantWhere(cond)),
            }),
          };
        },
      }),
    })
  );
});

it('stores billable and the cost from the settings in force', async () => {
  await recordDeliveryStatus(report('delivered', true));
  expect(updateSet).toHaveBeenCalledWith({ billable: true, costInr: '0.1357' });
  expect(transaction).not.toHaveBeenCalled();
});

it('does nothing for a status without pricing, such as read', async () => {
  await recordDeliveryStatus(report('read'));
  expect(updateSet).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});

it('gives back a failed free message: refunded, cost 0, no grant change', async () => {
  txReturning.mockResolvedValue([{ paidWith: 'plan', creditGrantId: null }]);
  await recordDeliveryStatus(report('failed'));

  expect(txSet).toHaveBeenCalledWith(
    expect.objectContaining({
      billable: false,
      costInr: '0',
      refundedAt: expect.any(Date),
    })
  );
  expect(txSet).toHaveBeenCalledTimes(1);
});

it('returns a credit to the grant that paid, when Meta does not bill', async () => {
  txReturning.mockResolvedValue([{ paidWith: 'credit', creditGrantId: 'g1' }]);
  await recordDeliveryStatus(report('delivered', false));

  expect(txSet).toHaveBeenCalledTimes(2);
  expect(txGrantWhere).toHaveBeenCalledTimes(1);
});

it('refunds once: an already refunded message is left alone', async () => {
  selectLimit.mockResolvedValue([
    { channel: 'whatsapp', refundedAt: new Date() },
  ]);
  await recordDeliveryStatus(report('failed'));
  expect(transaction).not.toHaveBeenCalled();
});

it('a racing second refund finds nothing to update and returns no credit', async () => {
  txReturning.mockResolvedValue([]);
  await recordDeliveryStatus(report('failed'));
  expect(txSet).toHaveBeenCalledTimes(1);
  expect(txGrantWhere).not.toHaveBeenCalled();
});

it('retries an unknown message once after 30 s, then warns', async () => {
  jest.useFakeTimers();
  selectLimit.mockResolvedValue([]);

  await recordDeliveryStatus(report('delivered', true));
  expect(warn).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(30_000);
  expect(selectLimit).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('wamid.1'));
  jest.useRealTimers();
});

it('logs and resolves on a database error', async () => {
  selectLimit.mockRejectedValue(new Error('db down'));
  await expect(recordDeliveryStatus(report('failed'))).resolves.toBeUndefined();
  expect(logError).toHaveBeenCalledWith(expect.stringContaining('wamid.1'));
});
