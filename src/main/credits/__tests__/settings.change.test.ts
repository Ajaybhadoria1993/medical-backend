// CreditSettingsService.change: a new version with who and why; never in the past; clears the cache.
const returning = jest.fn();
const values = jest.fn((_row: unknown) => ({ returning }));
jest.mock('../../../configurations/dbConnection', () => ({
  database: { insert: () => ({ values: (row: unknown) => values(row) }) },
}));

const invalidateCache = jest.fn();
jest.mock('../../../utils/cache.util', () => ({
  CacheKeys: { creditSettings: (type: string) => `credits:settings:${type}` },
  getOrSetCache: jest.fn(),
  invalidateCache: (...args: unknown[]) => invalidateCache(...args),
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { CreditSettingsService } from '../services/core/settings.service';

const body = {
  expiryDays: 365,
  reminderDays: 7,
  warnPercent: 70,
  unitCostInr: '0.1300',
  taxPercent: '18.00',
  reason: 'Meta rate change',
};

beforeEach(() => {
  jest.clearAllMocks();
  returning.mockResolvedValue([{ id: 's2' }]);
});

it('adds a version starting now, records who and why, then clears the cache', async () => {
  await CreditSettingsService.change('whatsapp', body, 'sa1');

  expect(values).toHaveBeenCalledWith(
    expect.objectContaining({
      creditType: 'whatsapp',
      warnPercent: 70,
      unitCostInr: '0.1300',
      changedBy: 'sa1',
      reason: 'Meta rate change',
      effectiveFrom: expect.any(Date),
    })
  );
  expect(invalidateCache).toHaveBeenCalledWith('credits:settings:whatsapp');
});

it('schedules a version for a future start', async () => {
  await CreditSettingsService.change(
    'whatsapp',
    { ...body, effectiveFrom: '2099-01-01T00:00:00+05:30' },
    'sa1'
  );
  expect(
    (values.mock.calls[0][0] as { effectiveFrom: Date }).effectiveFrom
  ).toEqual(new Date('2098-12-31T18:30:00Z'));
});

it('refuses a start in the past (422) and writes nothing', async () => {
  await expect(
    CreditSettingsService.change(
      'whatsapp',
      { ...body, effectiveFrom: '2020-01-01T00:00:00+05:30' },
      'sa1'
    )
  ).rejects.toMatchObject({ status: 422 });
  expect(values).not.toHaveBeenCalled();
  expect(invalidateCache).not.toHaveBeenCalled();
});

it('turns a clash with another version at the same start into a 409', async () => {
  returning.mockRejectedValue(
    Object.assign(new Error('dup'), { code: '23505' })
  );
  await expect(
    CreditSettingsService.change('whatsapp', body, 'sa1')
  ).rejects.toMatchObject({ status: 409 });
  expect(invalidateCache).not.toHaveBeenCalled();
});
