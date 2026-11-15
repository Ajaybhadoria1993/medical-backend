import { database } from '../../../configurations/dbConnection';
import { TaxService } from '../services/billing/tax.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
// No Redis in tests: the loader runs every time.
jest.mock('../../../utils/cache.util', () => ({
  getOrSetCache: (_k: string, _t: number, load: () => unknown) => load(),
  invalidateCache: jest.fn(),
}));

const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return q;
};
const d = (x: string) => new Date(`${x}T00:00:00+05:30`);
const row = (effectiveFrom: string, rateBp: number, mode: string) => ({
  id: effectiveFrom,
  rateBp,
  mode,
  effectiveFrom: d(effectiveFrom),
  noticeDays: 0,
  reason: 'test',
  createdBy: 'sa-1',
  cancelledAt: null,
  cancelledBy: null,
  createdAt: d('2026-11-01'),
});

describe('TaxService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('uses 18% inclusive until a setting is saved', async () => {
    (database.select as jest.Mock).mockReturnValue(rowsOf([]));
    expect(await TaxService.inForce(d('2026-11-11'))).toEqual({
      rateBp: 1800,
      mode: 'inclusive',
    });
  });

  it('picks the newest setting that has started, and shows the next one', async () => {
    (database.select as jest.Mock).mockReturnValue(
      rowsOf([
        row('2026-11-01', 1800, 'inclusive'),
        row('2026-12-01', 1800, 'exclusive'),
        row('2027-04-01', 1200, 'exclusive'),
      ])
    );
    expect(await TaxService.inForce(d('2026-11-30'))).toEqual({
      rateBp: 1800,
      mode: 'inclusive',
    });
    expect(await TaxService.inForce(d('2026-12-01'))).toEqual({
      rateBp: 1800,
      mode: 'exclusive',
    });
    expect((await TaxService.upcoming(d('2026-12-15')))?.rateBp).toBe(1200);
  });
});
