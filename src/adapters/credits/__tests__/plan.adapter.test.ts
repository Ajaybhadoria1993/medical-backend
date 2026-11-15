// planAdapter: plan row → free-message limit, and which date anchors the billing month.
const limit = jest.fn();
jest.mock('../../../configurations/dbConnection', () => {
  const chain: Record<string, unknown> = {};
  for (const step of ['select', 'from', 'where', 'orderBy']) {
    chain[step] = () => chain;
  }
  chain.limit = (...args: unknown[]) => limit(...args);
  return { database: chain };
});

const getClinicActivePlan = jest.fn();
const getPlanLimit = jest.fn();
jest.mock('../../../main/subscription/services/limitation.service', () => ({
  FEATURE_KEYS: { WHATSAPP_MESSAGES: 'whatsapp_messages_per_month' },
  LimitationService: {
    getClinicActivePlan: (...args: unknown[]) => getClinicActivePlan(...args),
    getPlanLimit: (...args: unknown[]) => getPlanLimit(...args),
  },
}));

import { planAdapter } from '../plan.adapter';

const limitOf = () => planAdapter.getMessageLimit('c1', 'whatsapp');

beforeEach(() => {
  jest.clearAllMocks();
  getClinicActivePlan.mockResolvedValue({ planId: 'p1', planSlug: 'clinic' });
});

it('reads the WhatsApp feature of the clinic plan', async () => {
  getPlanLimit.mockResolvedValue({
    isUnlimited: false,
    enabled: true,
    limitValue: 1000,
  });
  await expect(limitOf()).resolves.toEqual({ unlimited: false, limit: 1000 });
  expect(getPlanLimit).toHaveBeenCalledWith(
    'p1',
    'whatsapp_messages_per_month'
  );
});

it('treats no plan, no row, or an unlimited row as unlimited', async () => {
  getClinicActivePlan.mockResolvedValueOnce(null);
  await expect(limitOf()).resolves.toEqual({ unlimited: true });

  getPlanLimit.mockResolvedValueOnce(null);
  await expect(limitOf()).resolves.toEqual({ unlimited: true });

  getPlanLimit.mockResolvedValueOnce({
    isUnlimited: true,
    enabled: true,
    limitValue: null,
  });
  await expect(limitOf()).resolves.toEqual({ unlimited: true });
});

it('gives a disabled feature, or a missing value, zero free messages', async () => {
  getPlanLimit.mockResolvedValueOnce({
    isUnlimited: false,
    enabled: false,
    limitValue: 500,
  });
  await expect(limitOf()).resolves.toEqual({ unlimited: false, limit: 0 });

  getPlanLimit.mockResolvedValueOnce({
    isUnlimited: false,
    enabled: true,
    limitValue: null,
  });
  await expect(limitOf()).resolves.toEqual({ unlimited: false, limit: 0 });
});

describe('getBillingAnchor', () => {
  const anchorOf = () => planAdapter.getBillingAnchor('c1');

  it('uses the active plan start', async () => {
    const startsAt = new Date('2026-01-20T09:30:00Z');
    limit.mockResolvedValueOnce([{ startsAt }]);
    await expect(anchorOf()).resolves.toEqual(startsAt);
  });

  it('uses when the last plan ended, for a clinic now on the free plan', async () => {
    const expiresAt = new Date('2026-08-14T18:30:00Z');
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ expiresAt }]);
    await expect(anchorOf()).resolves.toEqual(expiresAt);
  });

  it('falls back to clinic creation, converting its IST wall clock to a real instant', async () => {
    // Stored "2026-03-05 10:00" IST reads back as 10:00Z; the real moment is 04:30Z.
    limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ createdAt: new Date('2026-03-05T10:00:00Z') }]);
    await expect(anchorOf()).resolves.toEqual(new Date('2026-03-05T04:30:00Z'));
  });
});
