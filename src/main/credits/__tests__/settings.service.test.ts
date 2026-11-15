// CreditSettingsService.getInForce: the latest started row wins; scheduled rows wait; defaults fill gaps.
const getOrSetCache = jest.fn();
jest.mock('../../../utils/cache.util', () => ({
  CacheKeys: { creditSettings: (type: string) => `credits:settings:${type}` },
  getOrSetCache: (...args: unknown[]) => getOrSetCache(...args),
}));

import { CreditSettingsService } from '../services/core/settings.service';
import { DEFAULT_CREDIT_SETTINGS } from '../utils/creditTypes.utils';

const row = (effectiveFrom: string, warnPercent: number) => ({
  expiryDays: 365,
  reminderDays: 7,
  warnPercent,
  unitCostInr: '0.1150',
  taxPercent: '18.00',
  effectiveFrom,
});

beforeEach(() => jest.clearAllMocks());

it('uses the latest row that has started, ignoring a scheduled one', async () => {
  getOrSetCache.mockResolvedValue([
    row('2026-01-01T00:00:00.000Z', 80),
    row('2026-10-01T00:00:00.000Z', 70),
    row('2027-01-01T00:00:00.000Z', 50), // scheduled
  ]);

  const now = new Date('2026-11-25T00:00:00Z');
  await expect(
    CreditSettingsService.getInForce('whatsapp', now)
  ).resolves.toEqual({
    expiryDays: 365,
    reminderDays: 7,
    warnPercent: 70,
    unitCostInr: '0.1150',
    taxPercent: '18.00',
  });
  expect(getOrSetCache.mock.calls[0][0]).toBe('credits:settings:whatsapp');
});

it('switches to the scheduled row once its time comes, from the same cached list', async () => {
  getOrSetCache.mockResolvedValue([
    row('2026-01-01T00:00:00.000Z', 80),
    row('2027-01-01T00:00:00.000Z', 50),
  ]);
  const settings = await CreditSettingsService.getInForce(
    'whatsapp',
    new Date('2027-01-01T00:00:01Z')
  );
  expect(settings.warnPercent).toBe(50);
});

it('falls back to the defaults when no row has started yet', async () => {
  getOrSetCache.mockResolvedValue([]);
  await expect(CreditSettingsService.getInForce('whatsapp')).resolves.toEqual(
    DEFAULT_CREDIT_SETTINGS.whatsapp
  );
});
