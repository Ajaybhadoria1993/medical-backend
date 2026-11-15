// UsageService: the send check (fails open) and the record after send (never throws, warns once).
import { TransactionRollbackError } from 'drizzle-orm';

const onConflictDoNothing = jest.fn();
const values = jest.fn((_row: unknown) => ({ onConflictDoNothing }));
const insert = jest.fn((_table: unknown) => ({ values }));

// The credit path: one transaction takes the credit and writes the row.
const txValues = jest.fn();
const txInserted = jest.fn();
const transaction = jest.fn(async (cb: (tx: unknown) => unknown) =>
  cb({
    insert: () => ({
      values: (row: unknown) => {
        txValues(row);
        return {
          onConflictDoNothing: () => ({ returning: () => txInserted() }),
        };
      },
    }),
    rollback: () => {
      throw new TransactionRollbackError();
    },
  })
);
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    insert: (table: unknown) => insert(table),
    transaction: (cb: (tx: unknown) => unknown) => transaction(cb),
  },
}));

const useOne = jest.fn();
jest.mock('../services/core/grants.service', () => ({
  GrantsService: { useOne: (...args: unknown[]) => useOne(...args) },
}));

const logError = jest.fn();
const logInfo = jest.fn();
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: (...args: unknown[]) => logError(...args),
    info: (...args: unknown[]) => logInfo(...args),
    warn: jest.fn(),
  },
}));

const decide = jest.fn();
jest.mock('../services/core/allowance.service', () => ({
  AllowanceService: { decide: (...args: unknown[]) => decide(...args) },
}));

const getInForce = jest.fn();
jest.mock('../services/core/settings.service', () => ({
  CreditSettingsService: {
    getInForce: (...args: unknown[]) => getInForce(...args),
  },
}));

const warning = jest.fn();
const paused = jest.fn();
jest.mock('../services/messaging/alerts.service', () => ({
  AlertsService: {
    warning: (...args: unknown[]) => warning(...args),
    paused: (...args: unknown[]) => paused(...args),
  },
}));

import { checkSend, recordSent } from '..';

const period = {
  start: new Date('2026-11-19T18:30:00Z'),
  end: new Date('2026-12-19T18:30:00Z'),
};
const planDecision = (used: number, limit = 10) => ({
  source: used < limit ? 'plan' : 'none',
  used,
  limit,
  period,
});
const input = {
  clinicId: 'c1',
  channel: 'whatsapp' as const,
  messageId: 'wamid.1',
  templateKey: 'appointmentBooked',
};

beforeEach(() => {
  jest.clearAllMocks();
  onConflictDoNothing.mockResolvedValue(undefined);
  getInForce.mockResolvedValue({ warnPercent: 80 });
});

describe('checkSend', () => {
  it('allows unlimited plans and free messages left', async () => {
    decide.mockResolvedValueOnce({ source: 'unlimited' });
    await expect(checkSend('c1', 'whatsapp', 'x')).resolves.toEqual({
      allowed: true,
    });

    decide.mockResolvedValueOnce(planDecision(9));
    await expect(checkSend('c1', 'whatsapp', 'x')).resolves.toEqual({
      allowed: true,
    });
    expect(paused).not.toHaveBeenCalled();
  });

  it('refuses when nothing is left, logs it, and sends the paused alert', async () => {
    decide.mockResolvedValue(planDecision(10));
    await expect(
      checkSend('c1', 'whatsapp', 'appointmentReminder')
    ).resolves.toEqual({
      allowed: false,
    });

    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('appointmentReminder')
    );
    expect(paused).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', used: 10, limit: 10, period })
    );
  });

  it('fails open: a lookup error still sends', async () => {
    decide.mockRejectedValue(new Error('redis down'));
    await expect(checkSend('c1', 'whatsapp', 'x')).resolves.toEqual({
      allowed: true,
    });
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('recordSent', () => {
  it('records an unlimited plan as unlimited, ignoring a repeated message id', async () => {
    decide.mockResolvedValue({ source: 'unlimited' });
    await recordSent(input);

    expect(values).toHaveBeenCalledWith({ ...input, paidWith: 'unlimited' });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('records a limited plan as a free message', async () => {
    decide.mockResolvedValue(planDecision(3));
    await recordSent(input);
    expect(values).toHaveBeenCalledWith({ ...input, paidWith: 'plan' });
  });

  it('warns on the message that reaches the warning point, and only that one', async () => {
    decide.mockResolvedValueOnce(planDecision(7));
    await recordSent(input);
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ used: 8, limit: 10, period })
    );

    warning.mockClear();
    decide.mockResolvedValueOnce(planDecision(8));
    await recordSent(input);
    expect(warning).not.toHaveBeenCalled();
  });

  it('pays with a credit from the soonest-expiring grant, in one transaction', async () => {
    decide.mockResolvedValue({ ...planDecision(10), source: 'credit' });
    useOne.mockResolvedValue('g1');
    txInserted.mockResolvedValue([{ id: 'row1' }]);
    await recordSent(input);

    expect(useOne).toHaveBeenCalledWith(expect.anything(), 'c1', 'whatsapp');
    expect(txValues).toHaveBeenCalledWith({
      ...input,
      paidWith: 'credit',
      creditGrantId: 'g1',
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it('counts a message that raced past free messages and credits as a free message', async () => {
    decide.mockResolvedValue(planDecision(10));
    useOne.mockResolvedValue(null);
    txInserted.mockResolvedValue([{ id: 'row1' }]);
    await recordSent(input);

    expect(txValues).toHaveBeenCalledWith({
      ...input,
      paidWith: 'plan',
      creditGrantId: null,
    });
  });

  it('rolls back a repeated message id, so it never costs a second credit', async () => {
    decide.mockResolvedValue({ ...planDecision(10), source: 'credit' });
    useOne.mockResolvedValue('g1');
    txInserted.mockResolvedValue([]);

    await expect(recordSent(input)).resolves.toBeUndefined();
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs and resolves when the insert fails, so the outbox never resends', async () => {
    decide.mockResolvedValue({ source: 'unlimited' });
    onConflictDoNothing.mockRejectedValue(new Error('db down'));

    await expect(recordSent(input)).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('wamid.1'));
  });

  it('logs and resolves when the allowance lookup fails', async () => {
    decide.mockRejectedValue(new Error('redis down'));

    await expect(recordSent(input)).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
