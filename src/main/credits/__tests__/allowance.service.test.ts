// AllowanceService.decide: unlimited, free message, or nothing left, counted from the renewal date.
const where = jest.fn();
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => ({ from: () => ({ where: (cond: unknown) => where(cond) }) }),
  },
}));

const balance = jest.fn();
jest.mock('../services/core/grants.service', () => ({
  GrantsService: { balance: (...args: unknown[]) => balance(...args) },
}));

import { registerPlanPort } from '..';
import { AllowanceService } from '../services/core/allowance.service';

const getMessageLimit = jest.fn();
const getBillingAnchor = jest.fn();
registerPlanPort({
  getMessageLimit,
  getBillingAnchor,
  getPlansWithoutMessageLimit: jest.fn(),
});

const now = new Date('2026-11-25T06:00:00Z');
const anchor = new Date('2026-01-20T09:30:00Z'); // 20 Jan, 15:00 IST

beforeEach(() => {
  jest.clearAllMocks();
  getBillingAnchor.mockResolvedValue(anchor);
  balance.mockResolvedValue(0);
});

it('is unlimited without counting anything', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: true });
  await expect(AllowanceService.decide('c1', 'whatsapp', now)).resolves.toEqual(
    {
      source: 'unlimited',
    }
  );
  expect(getBillingAnchor).not.toHaveBeenCalled();
  expect(where).not.toHaveBeenCalled();
});

it('uses a free message while some are left, counting from the renewal date', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: false, limit: 10 });
  where.mockResolvedValue([{ used: 9 }]);

  await expect(AllowanceService.decide('c1', 'whatsapp', now)).resolves.toEqual(
    {
      source: 'plan',
      used: 9,
      limit: 10,
      period: {
        start: new Date('2026-11-19T18:30:00Z'), // 20 Nov 00:00 IST
        end: new Date('2026-12-19T18:30:00Z'),
      },
    }
  );
  expect(getMessageLimit).toHaveBeenCalledWith('c1', 'whatsapp');
});

it('has nothing left at the limit', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: false, limit: 10 });
  where.mockResolvedValue([{ used: 10 }]);
  const decision = await AllowanceService.decide('c1', 'whatsapp', now);
  expect(decision.source).toBe('none');
});

it('treats a zero limit (feature disabled) as nothing left', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: false, limit: 0 });
  where.mockResolvedValue([{ used: 0 }]);
  const decision = await AllowanceService.decide('c1', 'whatsapp', now);
  expect(decision.source).toBe('none');
});

it('uses a credit once free messages run out, and never before', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: false, limit: 10 });
  balance.mockResolvedValue(5);

  where.mockResolvedValueOnce([{ used: 9 }]);
  expect((await AllowanceService.decide('c1', 'whatsapp', now)).source).toBe(
    'plan'
  );
  expect(balance).not.toHaveBeenCalled();

  where.mockResolvedValueOnce([{ used: 10 }]);
  expect((await AllowanceService.decide('c1', 'whatsapp', now)).source).toBe(
    'credit'
  );
  expect(balance).toHaveBeenCalledWith('c1', 'whatsapp');
});

it('has nothing left when free messages and credits are both used up', async () => {
  getMessageLimit.mockResolvedValue({ unlimited: false, limit: 10 });
  where.mockResolvedValue([{ used: 10 }]);
  balance.mockResolvedValue(0);
  expect((await AllowanceService.decide('c1', 'whatsapp', now)).source).toBe(
    'none'
  );
});
