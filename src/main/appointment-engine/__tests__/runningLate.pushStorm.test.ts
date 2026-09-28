// Concurrent evaluators and a wobbling delay must each yield one push, while
// the `notified` flag (live "running late" UI state) still tracks the delay.

const store = new Map<string, string>();

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    exists: jest.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
  },
}));
jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../services/delayTracker.service', () => ({
  DelayTrackerService: jest.fn(),
}));
jest.mock('../utils/doctorDisplayName', () => ({
  getDoctorDisplayName: jest.fn(async () => 'Dr Rao'),
}));
jest.mock('../../notifications/services/universalNotification.service', () => ({
  UniversalNotificationService: { send: jest.fn(async () => undefined) },
}));

import { RunningLateNotifier } from '../services/runningLateNotifier.service';
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';
import { getRedisKey } from '../utils/helpers';
import type { QueueDelayData } from '../types/engine.types';

const send = UniversalNotificationService.send as jest.Mock;
const APPT = 'appt-1';

const queueWithDelay = (estimatedWaitMinutes: number) =>
  ({
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    date: '2026-09-23',
    cumulativeDelayMinutes: estimatedWaitMinutes,
    lastCalculatedAt: '',
    appointments: [
      {
        appointmentId: APPT,
        patientId: 'patient-1',
        userId: 'patient-1',
        status: 'Upcoming',
        scheduledTime: null, // no real-time branch: delay is exactly the input
        tokenNo: null,
        projectedStartTime: '10:00',
        estimatedWaitMinutes,
        durationMinutes: 10,
      },
    ],
  }) as unknown as QueueDelayData;

const evaluate = (delay: number) =>
  new RunningLateNotifier().evaluateFromCache(
    'clinic-1',
    'doctor-1',
    '2026-09-23',
    queueWithDelay(delay)
  );

beforeEach(() => {
  store.clear();
  store.set(getRedisKey('threshold', 'clinic-1'), '10'); // skip the DB read
  send.mockClear();
});

it('concurrent evaluators crossing together send one push', async () => {
  await Promise.all([evaluate(20), evaluate(20), evaluate(20)]);
  expect(send).toHaveBeenCalledTimes(1);
});

it('a delay wobbling around the threshold does not re-push within the cooldown', async () => {
  await evaluate(20);
  await evaluate(5); // dips below: UI flag clears, as before
  expect(store.has(getRedisKey('notified', APPT))).toBe(false);
  await evaluate(20);
  await evaluate(5);
  await evaluate(25);

  expect(send).toHaveBeenCalledTimes(1);
  // UI state still follows the delay even when the push is suppressed.
  expect(store.get(getRedisKey('notified', APPT))).toBe('25');
});

it('pushes again once the cooldown has expired', async () => {
  await evaluate(20);
  await evaluate(5);
  store.delete(getRedisKey('late_push', APPT)); // cooldown TTL elapsed
  await evaluate(20);
  expect(send).toHaveBeenCalledTimes(2);
});
