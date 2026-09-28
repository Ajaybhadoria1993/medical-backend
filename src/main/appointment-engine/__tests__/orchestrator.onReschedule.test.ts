/**
 * Unit test for AppointmentEngineOrchestrator.onReschedule.
 *
 * Guards the fix for a real bug: rescheduling an appointment used to only
 * recalculate the queue's delay cache when notifications were enabled for
 * the clinic AND the patient had a mobile number on file (buried inside the
 * SMS/WhatsApp reminder gating in appointment.service.ts). A clinic with
 * notifications off, or a patient with no mobile, could reschedule to a new
 * time and leave the cached delay/turn-time projection stale for up to 24h —
 * the patient's "Appt. Time" (read fresh from the DB) would show the new
 * time while their queue position/turn-time silently kept showing the old
 * one. `onReschedule` is now called unconditionally whenever a reschedule
 * changes the date/time of a today appointment, mirroring onQueueAction /
 * onSessionOverride (already proven end-to-end in
 * orchestrator.onQueueAction.test.ts — this test only needs to confirm
 * onReschedule reuses that same pipeline, not re-prove the broadcast).
 */

const recalculateMock = jest.fn().mockResolvedValue({
  clinicId: 'clinic-1',
  doctorId: 'doctor-1',
  date: '2026-08-14',
  cumulativeDelayMinutes: 0,
  lastCalculatedAt: '2026-08-14T10:00:00.000Z',
  appointments: [],
});

jest.mock('../services/delayTracker.service', () => ({
  DelayTrackerService: jest.fn().mockImplementation(() => ({
    recalculate: recalculateMock,
  })),
}));

jest.mock('../services/runningLateNotifier.service', () => ({
  RunningLateNotifier: jest.fn().mockImplementation(() => ({
    evaluateFromCache: jest.fn().mockResolvedValue(undefined),
    getThresholdMinutes: jest.fn().mockResolvedValue(10),
  })),
}));

jest.mock('../services/timeToNext.service', () => ({
  TimeToNextService: jest.fn().mockImplementation(() => ({
    computeAndBroadcastFromQueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

const emitQueueUpdatedMock = jest.fn();
const emitPatientUpdatedMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/queueBroadcast.service', () => ({
  QueueBroadcastService: jest.fn().mockImplementation(() => ({
    emitQueueUpdated: emitQueueUpdatedMock,
    emitPatientUpdated: emitPatientUpdatedMock,
  })),
}));

import { AppointmentEngineOrchestrator } from '../services/orchestrator.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

beforeEach(() => jest.clearAllMocks());

describe('AppointmentEngineOrchestrator.onReschedule', () => {
  it('recalculates and broadcasts for the rescheduled date, unconditionally', async () => {
    await new AppointmentEngineOrchestrator().onReschedule(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(recalculateMock).toHaveBeenCalledWith(CLINIC, DOCTOR, DATE);
    expect(emitQueueUpdatedMock).toHaveBeenCalledTimes(1);
    expect(emitPatientUpdatedMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, even if recalculation fails', async () => {
    recalculateMock.mockRejectedValueOnce(new Error('db down'));

    await expect(
      new AppointmentEngineOrchestrator().onReschedule(CLINIC, DOCTOR, DATE)
    ).resolves.toBeUndefined();
  });
});
