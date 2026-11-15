// GrantsService: add with expiry, remove soonest-expiring first (never below 0), use one credit safely.
const insertReturning = jest.fn();
const grantValues = jest.fn();
const forUpdate = jest.fn();
const txUpdateSet = jest.fn();
const txInsertValues = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    insert: () => ({
      values: (values: unknown) => {
        grantValues(values);
        return { returning: () => insertReturning() };
      },
    }),
    transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        select: () => ({
          from: () => ({
            where: () => ({ orderBy: () => ({ for: () => forUpdate() }) }),
          }),
        }),
        update: () => ({
          set: (values: unknown) => {
            txUpdateSet(values);
            return { where: async () => undefined };
          },
        }),
        insert: () => ({
          values: (values: unknown) => {
            txInsertValues(values);
            return {
              returning: async () => [
                { id: 'removal-1', ...(values as object) },
              ],
            };
          },
        }),
      }),
  },
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/core/settings.service', () => ({
  CreditSettingsService: { getInForce: async () => ({ expiryDays: 365 }) },
}));

import { GrantsService } from '../services/core/grants.service';

const change = (credits: number) => ({
  clinicId: 'c1',
  creditType: 'whatsapp' as const,
  credits,
  reason: 'Goodwill after outage',
  actorUserId: 'sa1',
});

beforeEach(() => jest.clearAllMocks());

describe('grant', () => {
  it('adds credits that expire after the expiry days in force', async () => {
    insertReturning.mockResolvedValue([{ id: 'g1' }]);
    const before = Date.now();
    await GrantsService.grant(change(500));

    const row = grantValues.mock.calls[0][0];
    expect(row).toMatchObject({
      clinicId: 'c1',
      source: 'grant',
      creditsTotal: 500,
      creditsLeft: 500,
      grantedBy: 'sa1',
      reason: 'Goodwill after outage',
    });
    const days = (row.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(365);
    expect(days).toBeLessThan(365.01);
  });

  it('refuses zero, negative or fractional credits', async () => {
    await expect(GrantsService.grant(change(0))).rejects.toMatchObject({
      status: 422,
    });
    await expect(GrantsService.grant(change(-5))).rejects.toMatchObject({
      status: 422,
    });
    await expect(GrantsService.grant(change(2.5))).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe('remove', () => {
  it('takes from the soonest-expiring grants first and records the removal', async () => {
    // Already ordered soonest-expiring first by the query.
    forUpdate.mockResolvedValue([
      { id: 'g-soon', creditsLeft: 3 },
      { id: 'g-later', creditsLeft: 10 },
    ]);
    await GrantsService.remove(change(5));

    expect(txUpdateSet).toHaveBeenNthCalledWith(1, { creditsLeft: 0 }); // 3 taken
    expect(txUpdateSet).toHaveBeenNthCalledWith(2, { creditsLeft: 8 }); // 2 taken
    expect(txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'removal',
        creditsTotal: 5,
        creditsLeft: 0,
        grantedBy: 'sa1',
        reason: 'Goodwill after outage',
      })
    );
  });

  it('refuses to remove more than the clinic has (409), changing nothing', async () => {
    forUpdate.mockResolvedValue([{ id: 'g1', creditsLeft: 3 }]);
    await expect(GrantsService.remove(change(10))).rejects.toMatchObject({
      status: 409,
    });
    expect(txUpdateSet).not.toHaveBeenCalled();
    expect(txInsertValues).not.toHaveBeenCalled();
  });
});

describe('useOne', () => {
  const tx = (updates: unknown[][], nexts: unknown[][]) => ({
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => updates.shift() ?? [] }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => nexts.shift() ?? [] }),
      }),
    }),
  });

  it('returns the grant it took a credit from', async () => {
    await expect(
      GrantsService.useOne(tx([[{ id: 'g1' }]], []) as never, 'c1', 'whatsapp')
    ).resolves.toBe('g1');
  });

  it('retries the next grant when a concurrent send took the last credit', async () => {
    await expect(
      GrantsService.useOne(
        tx([[], [{ id: 'g2' }]], [[{ id: 'g2' }]]) as never,
        'c1',
        'whatsapp'
      )
    ).resolves.toBe('g2');
  });

  it('returns null when no credits are left', async () => {
    await expect(
      GrantsService.useOne(tx([[]], [[]]) as never, 'c1', 'whatsapp')
    ).resolves.toBeNull();
  });
});
