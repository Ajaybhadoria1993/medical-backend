import { database } from '../../../configurations/dbConnection';
import { AddOnAdminService } from '../services/core/addOnAdmin.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), insert: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../utils/cache.util', () => ({
  CacheKeys: { addOnCatalog: 'c', allPlans: 'p' },
  invalidateCacheMany: jest.fn(),
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'values', 'returning'])
    q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const tomorrow = () => new Date(Date.now() + 86_400_000);

describe('AddOnAdminService prices', () => {
  beforeEach(() => jest.resetAllMocks());

  it('refuses a start date in the past', async () => {
    await expect(
      AddOnAdminService.schedulePrice(
        'a1',
        {
          monthlyPrice: 599,
          yearlyPrice: 5990,
          effectiveFrom: new Date('2020-01-01'),
        },
        null
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(database.select).not.toHaveBeenCalled();
  });

  it('refuses a second scheduled change while one is waiting', async () => {
    (database.select as jest.Mock)
      .mockReturnValueOnce(rowsOf([{ id: 'a1' }]))
      .mockReturnValueOnce(rowsOf([{ id: 'p1' }]));
    await expect(
      AddOnAdminService.schedulePrice(
        'a1',
        { monthlyPrice: 599, yearlyPrice: 5990, effectiveFrom: tomorrow() },
        null
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(database.insert).not.toHaveBeenCalled();
  });

  it('will not cancel a change that has already started', async () => {
    (database.delete as jest.Mock).mockReturnValueOnce(rowsOf([]));
    await expect(
      AddOnAdminService.cancelPrice('a1', 'p1')
    ).rejects.toMatchObject({ status: 409 });
  });
});
