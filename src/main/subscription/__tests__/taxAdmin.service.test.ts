import { database } from '../../../configurations/dbConnection';
import { TaxAdminService } from '../services/billing/taxAdmin.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { insert: jest.fn(), select: jest.fn(), transaction: jest.fn() },
}));
jest.mock('../notify/subscriptionNotify', () => ({
  subscriptionNotify: jest.fn(),
}));
jest.mock('../services/core/plans.service', () => ({ PlansService: {} }));
// 18% inclusive in force, nothing scheduled.
jest.mock('../services/billing/tax.service', () => ({
  TaxService: {
    inForce: async () => ({ rateBp: 1800, mode: 'inclusive' }),
    snapshot: async () => ({
      current: { rateBp: 1800, mode: 'inclusive' },
      upcoming: null,
    }),
    invalidate: async () => undefined,
  },
}));

const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of [
    'values',
    'returning',
    'from',
    'innerJoin',
    'where',
    'limit',
  ])
    q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return q;
};
const ymd = (days: number) =>
  new Date(Date.now() + days * 86_400_000 + 5.5 * 3_600_000)
    .toISOString()
    .slice(0, 10);
const schedule = (over: Record<string, unknown>) =>
  TaxAdminService.schedule(
    {
      ratePercent: 18,
      mode: 'exclusive',
      applyNow: false,
      reason: 'Govt change',
      ...over,
    } as never,
    'sa-1'
  );

describe('TaxAdminService.schedule', () => {
  beforeEach(() => {
    (database.insert as jest.Mock).mockReturnValue(chain([{ id: 'tax-1' }]));
    (database.select as jest.Mock).mockReturnValue(chain([]));
    // The save runs in a transaction: no pending change, then the insert.
    (database.transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => unknown) =>
        fn({
          execute: async () => undefined,
          select: () => chain([]),
          insert: () => chain([{ id: 'tax-1' }]),
        })
    );
  });

  it('refuses a second change while one is scheduled', async () => {
    (database.transaction as jest.Mock).mockImplementation(
      (fn: (tx: unknown) => unknown) =>
        fn({
          execute: async () => undefined,
          select: () => chain([{ id: 'tax-0' }]),
          insert: () => chain([]),
        })
    );
    await expect(schedule({ applyNow: true })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('needs 30 days notice when clinics will pay more', async () => {
    await expect(schedule({ effectiveFrom: ymd(10) })).rejects.toMatchObject({
      status: 400,
    });
    await expect(schedule({ effectiveFrom: ymd(31) })).resolves.toMatchObject({
      id: 'tax-1',
    });
  });

  it('lets the Super Admin apply a rise now, without notice', async () => {
    await expect(schedule({ applyNow: true })).resolves.toMatchObject({
      id: 'tax-1',
    });
  });

  it('allows a change that does not raise prices from tomorrow', async () => {
    // Inclusive 12%: clinics still pay the same price.
    await expect(
      schedule({ ratePercent: 12, mode: 'inclusive', effectiveFrom: ymd(1) })
    ).resolves.toMatchObject({ id: 'tax-1' });
  });

  it('refuses a start date in the past', async () => {
    await expect(
      schedule({ ratePercent: 12, mode: 'inclusive', effectiveFrom: ymd(-2) })
    ).rejects.toMatchObject({ status: 400 });
  });
});
