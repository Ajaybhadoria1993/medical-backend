// ExpiryService: remind once per grant within reminder_days; a rerun sends nothing new.
const due = jest.fn();
const marked = jest.fn();
jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => due() }) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => marked() }) }),
    }),
  },
}));

const logError = jest.fn();
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: (...args: unknown[]) => logError(...args),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const getInForce = jest.fn();
jest.mock('../services/core/settings.service', () => ({
  CreditSettingsService: {
    getInForce: (...args: unknown[]) => getInForce(...args),
  },
}));

import { registerNotifyPort } from '..';
import { ExpiryService } from '../services/core/expiry.service';

const creditsExpiring = jest.fn();
registerNotifyPort({
  usageWarning: jest.fn(),
  usagePaused: jest.fn(),
  creditsExpiring,
});

const grant = {
  id: 'g1',
  clinicId: 'c1',
  creditsLeft: 150,
  expiresAt: new Date('2027-10-11T18:30:00Z'), // 12 Oct 2027 IST
};

beforeEach(() => {
  jest.clearAllMocks();
  getInForce.mockResolvedValue({ reminderDays: 7 });
});

it('marks a due grant, then reminds its clinic with the IST expiry date', async () => {
  due.mockResolvedValue([grant]);
  marked.mockResolvedValue([{ id: 'g1' }]);

  await expect(ExpiryService.runReminders()).resolves.toBe(1);
  expect(creditsExpiring).toHaveBeenCalledWith({
    clinicId: 'c1',
    creditType: 'whatsapp',
    grantId: 'g1',
    creditsLeft: 150,
    expiresOn: '12 Oct 2027',
  });
});

it('sends nothing for a grant another run already marked', async () => {
  due.mockResolvedValue([grant]);
  marked.mockResolvedValue([]);
  await expect(ExpiryService.runReminders()).resolves.toBe(0);
  expect(creditsExpiring).not.toHaveBeenCalled();
});

it('skips the type entirely when reminders are off (0 days)', async () => {
  getInForce.mockResolvedValue({ reminderDays: 0 });
  await expect(ExpiryService.runReminders()).resolves.toBe(0);
  expect(due).not.toHaveBeenCalled();
});

it('logs a failed alert and carries on with the rest', async () => {
  due.mockResolvedValue([grant, { ...grant, id: 'g2' }]);
  marked.mockResolvedValue([{ id: 'x' }]);
  creditsExpiring.mockRejectedValueOnce(new Error('queue down'));

  await expect(ExpiryService.runReminders()).resolves.toBe(1);
  expect(logError).toHaveBeenCalledWith(expect.stringContaining('g1'));
});
