/**
 * Unit test for QueueService.signal — the private fan-out every queue action
 * (send-in/hold/skip/resume) calls after writing its Redis pointer.
 *
 * Before this change, `signal` only notified the realtime bus (telling the
 * board to re-render itself) and never touched the appointment engine, so
 * `GET /appointments/queue-state` and the patient app stayed stale until the
 * next per-minute queueTick cron pass. This test guards the fix: `signal`
 * must also fire `AppointmentEngineOrchestrator.onQueueAction`, and a
 * rejection from that call must never escape `signal` (fire-and-forget).
 */

jest.mock('../../realtime', () => ({
  realtimeBus: { notify: jest.fn() },
  target: {
    queue: (clinicId: string, doctorId: string, date: string) => ({
      section: `queue:${clinicId}:${doctorId}:${date}`,
    }),
    board: (clinicId: string) => ({ section: `board:${clinicId}` }),
  },
}));

const invalidateDashboardCachesMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../../dashboard/utils/dashboardCache.utils', () => ({
  invalidateClinicDashboardCaches: (...args: unknown[]) =>
    invalidateDashboardCachesMock(...args),
}));

const onQueueActionMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/orchestrator.service', () => ({
  AppointmentEngineOrchestrator: jest.fn().mockImplementation(() => ({
    onQueueAction: onQueueActionMock,
  })),
}));

import { QueueService } from '../services/queue.service';
import { realtimeBus, target } from '../../realtime';
import { AppointmentEngineOrchestrator } from '../services/orchestrator.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

beforeEach(() => {
  jest.clearAllMocks();
  onQueueActionMock.mockResolvedValue(undefined);
  invalidateDashboardCachesMock.mockResolvedValue(undefined);
});

describe('QueueService.signal', () => {
  it('notifies both realtime sections and triggers the engine recalculation', async () => {
    (QueueService as any).signal(CLINIC, DOCTOR, DATE, 'queue.patient_held');

    // The recalculation runs first and the notify follows it, so that a client
    // refetching on the signal cannot read the pre-action cached snapshot.
    expect(onQueueActionMock).toHaveBeenCalledTimes(1);
    expect(realtimeBus.notify).not.toHaveBeenCalled();

    // Let the recalculation → cache bump → notify chain settle.
    await new Promise((resolve) => setImmediate(resolve));

    // Dashboard caches must be retired before the signal, or a refetch reads them stale.
    expect(invalidateDashboardCachesMock).toHaveBeenCalledWith(CLINIC);
    expect(
      invalidateDashboardCachesMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      (realtimeBus.notify as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(realtimeBus.notify).toHaveBeenCalledTimes(2);
    expect(realtimeBus.notify).toHaveBeenCalledWith(
      target.queue(CLINIC, DOCTOR, DATE),
      'queue.patient_held'
    );
    expect(realtimeBus.notify).toHaveBeenCalledWith(
      target.board(CLINIC),
      'queue.patient_held'
    );

    expect(AppointmentEngineOrchestrator).toHaveBeenCalledTimes(1);
    expect(onQueueActionMock).toHaveBeenCalledTimes(1);
    expect(onQueueActionMock).toHaveBeenCalledWith(CLINIC, DOCTOR, DATE);
  });

  it('never throws out of signal when onQueueAction rejects', async () => {
    onQueueActionMock.mockRejectedValue(new Error('boom'));

    expect(() =>
      (QueueService as any).signal(
        CLINIC,
        DOCTOR,
        DATE,
        'queue.patient_skipped'
      )
    ).not.toThrow();

    // Flush the microtask queue so the rejected promise's .catch() runs
    // before the test ends — an uncaught rejection here would fail the run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(onQueueActionMock).toHaveBeenCalledTimes(1);
  });

  it('still notifies the realtime bus even if it were to throw synchronously', () => {
    // realtimeBus.notify itself is wrapped in try/catch inside signal(); this
    // just confirms the existing guard still runs before the new engine call.
    (realtimeBus.notify as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bus down');
    });

    expect(() =>
      (QueueService as any).signal(
        CLINIC,
        DOCTOR,
        DATE,
        'queue.patient_sent_in'
      )
    ).not.toThrow();

    expect(onQueueActionMock).toHaveBeenCalledTimes(1);
  });
});
