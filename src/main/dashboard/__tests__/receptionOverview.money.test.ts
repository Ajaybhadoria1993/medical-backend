import { DashboardService } from '../services/dashboard.service';
import { database } from '../../../configurations/dbConnection';
import { MoneyReadService } from '../../money';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../../utils/cache.util', () => ({
  CacheKeys: { receptionOverview: () => 'k' },
  getOrSetCache: (_k: string, _t: number, fn: () => unknown) => fn(),
}));
jest.mock('otplib', () => ({}));
jest.mock('../../money', () => ({ MoneyReadService: { totals: jest.fn() } }));

/** A drizzle-like chain that resolves to the given rows whenever awaited. */
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  for (const m of [
    'from',
    'innerJoin',
    'where',
    'groupBy',
    'having',
    'orderBy',
  ])
    c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return c;
};

describe('DashboardService.getReceptionOverview money', () => {
  beforeEach(() => {
    // Order: counts, payments (pending), new patients, doctor queues.
    (database.select as jest.Mock)
      .mockReturnValueOnce(chain([{ total: 3 }]))
      .mockReturnValueOnce(
        chain([{ pendingAmount: '250.00', pendingCount: 1 }])
      )
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]));
  });
  afterEach(() => jest.resetAllMocks());

  it('takes Collected from the ledger, not the visit price', async () => {
    (MoneyReadService.totals as jest.Mock).mockResolvedValue({
      netPaise: 75050,
      payments: 2,
    });
    const out = await DashboardService.getReceptionOverview('c1', {
      doctorId: 'd1',
    });
    expect(out.payments).toEqual({
      collectedToday: 750.5,
      paidCount: 2,
      pendingAmount: 250,
      pendingCount: 1,
    });
    expect(
      (MoneyReadService.totals as jest.Mock).mock.calls[0][0]
    ).toMatchObject({ clinicId: 'c1', doctorIds: ['d1'] });
  });

  it('shows no money when the staff member may see no doctors', async () => {
    const out = await DashboardService.getReceptionOverview('c1', {
      allowedDoctorIds: [],
    });
    expect(out.payments.collectedToday).toBe(0);
    expect(MoneyReadService.totals).not.toHaveBeenCalled();
  });
});
