// AlertsService: one alert of each kind per clinic and period; failures never throw.
import redisClient from '../../../configurations/redisConfig';
import { registerNotifyPort } from '..';
import { AlertsService } from '../services/messaging/alerts.service';

const usageWarning = jest.fn();
const usagePaused = jest.fn();
registerNotifyPort({ usageWarning, usagePaused, creditsExpiring: jest.fn() });

const set = redisClient.set as unknown as jest.Mock;
const input = {
  clinicId: 'c1',
  channel: 'whatsapp' as const,
  used: 8,
  limit: 10,
  period: {
    start: new Date('2026-11-19T18:30:00Z'),
    end: new Date('2026-12-19T18:30:00Z'),
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('sends the warning the first time in a period, with the IST reset date', async () => {
  set.mockResolvedValue('OK');
  await AlertsService.warning(input);

  expect(set).toHaveBeenCalledWith(
    'credits:alert:c1:whatsapp:2026-11-19T18:30:00.000Z:warning',
    '1',
    'EX',
    expect.any(Number),
    'NX'
  );
  expect(usageWarning).toHaveBeenCalledWith({
    clinicId: 'c1',
    channel: 'whatsapp',
    used: 8,
    limit: 10,
    resetsOn: '20 Dec 2026',
    periodKey: '2026-11-19T18:30:00.000Z',
  });
});

it('sends nothing when the marker already exists for the period', async () => {
  set.mockResolvedValue(null);
  await AlertsService.paused(input);
  expect(usagePaused).not.toHaveBeenCalled();
});

it('keys warning and paused separately, so both can fire in one period', async () => {
  set.mockResolvedValue('OK');
  await AlertsService.paused(input);
  expect(set.mock.calls[0][0]).toMatch(/:paused$/);
  expect(usagePaused).toHaveBeenCalledTimes(1);
});

it('swallows a Redis failure', async () => {
  set.mockRejectedValue(new Error('redis down'));
  await expect(AlertsService.warning(input)).resolves.toBeUndefined();
  expect(usageWarning).not.toHaveBeenCalled();
});
