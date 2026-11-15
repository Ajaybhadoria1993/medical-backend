import { database } from '../../../configurations/dbConnection';
import { PricingService } from '../services/pricing.service';
import { DEFAULT_COMMISSION_PRICING } from '../utils/commissionPricing.utils';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');

const select = database.select as jest.Mock;

/** A drizzle-style chain that ends in `limit()`, resolving to `rows` or rejecting with `error`. */
const chain = (result: { rows?: unknown[]; error?: unknown }) => {
  const end = () =>
    result.error ? Promise.reject(result.error) : Promise.resolve(result.rows);
  const link: Record<string, unknown> = {};
  for (const name of ['from', 'where', 'orderBy']) link[name] = () => link;
  link.limit = end;
  return link;
};

const at = new Date('2026-11-14T00:00:00Z');

describe('PricingService.resolveFor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is the built-in default while the pricing table does not exist yet', async () => {
    const missing = Object.assign(new Error('relation does not exist'), {
      code: '42P01',
    });
    select.mockReturnValue(chain({ error: missing }));
    await expect(PricingService.resolveFor('clinic-1', at)).resolves.toEqual({
      pricing: DEFAULT_COMMISSION_PRICING,
      source: 'default',
    });
  });

  it('also reads a drizzle-wrapped missing-table error', async () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: { code: '42P01' },
    });
    select.mockReturnValue(chain({ error: wrapped }));
    await expect(PricingService.resolveFor(null, at)).resolves.toMatchObject({
      source: 'default',
    });
  });

  it('does not hide any other database error behind the default price', async () => {
    select.mockReturnValue(chain({ error: new Error('connection lost') }));
    await expect(PricingService.resolveFor('clinic-1', at)).rejects.toThrow(
      'connection lost'
    );
  });

  it("uses the clinic's own saved pricing when the table exists", async () => {
    const own = {
      clinicId: 'clinic-1',
      periodKind: 'half_monthly',
      tiers: [{ fromPatients: 0, ratePaise: 700 }],
      effectiveFrom: new Date('2026-05-01T00:00:00Z'),
    };
    select
      .mockReturnValueOnce(chain({ rows: [own] }))
      .mockReturnValueOnce(chain({ rows: [] }));
    const { pricing, source } = await PricingService.resolveFor('clinic-1', at);
    expect(source).toBe('clinic');
    expect(pricing.periodKind).toBe('half_monthly');
  });
});
