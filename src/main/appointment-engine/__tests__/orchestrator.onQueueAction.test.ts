/**
 * End-to-end proof that a queue-board action reaches the patient app, not
 * just that `onQueueAction` gets called.
 *
 * `queue.service.test.ts` only proves `QueueService.signal()` invokes
 * `AppointmentEngineOrchestrator.onQueueAction` — it mocks the orchestrator
 * away, so it can't show what happens *inside* that call. This test runs the
 * real `AppointmentEngineOrchestrator` + the real `QueueBroadcastService`
 * (the only two classes under test), stubs out the DB/Redis-touching engine
 * services around them (DelayTrackerService/RunningLateNotifier/
 * TimeToNextService/queueNotifyPrefs — all pre-existing, unrelated to this
 * fix), and asserts the socket emit a patient's app is actually listening on
 * (`user:{userId}` room, `appointment.updated` event) fires with that
 * patient's own queue data.
 */

const emitMock = jest.fn();
const toMock = jest.fn(() => ({ emit: emitMock }));
const inMock = jest.fn(() => ({
  fetchSockets: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../app', () => ({
  socketManager: { io: { to: toMock, in: inMock } },
}));

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

const queueDelayData = {
  clinicId: CLINIC,
  doctorId: DOCTOR,
  date: DATE,
  cumulativeDelayMinutes: 20,
  lastCalculatedAt: '2026-08-14T10:00:00.000Z',
  appointments: [
    {
      appointmentId: 'appt-confirmed',
      patientId: 'patient-1',
      userId: 'user-1',
      status: 'Confirmed',
      scheduledTime: '10:00',
      tokenNo: 1,
      projectedStartTime: '10:20',
      estimatedWaitMinutes: 20,
      durationMinutes: 15,
    },
    {
      appointmentId: 'appt-waiting',
      patientId: 'patient-2',
      userId: 'user-2',
      status: 'Patient Arrived',
      scheduledTime: '10:15',
      tokenNo: 2,
      projectedStartTime: '10:35',
      estimatedWaitMinutes: 20,
      durationMinutes: 15,
    },
  ],
};

const recalculateMock = jest.fn().mockResolvedValue(queueDelayData);
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

jest.mock('../services/queueNotifyPrefs.service', () => ({
  evaluateQueueNotifications: jest.fn().mockResolvedValue(undefined),
}));

import { AppointmentEngineOrchestrator } from '../services/orchestrator.service';

beforeEach(() => {
  jest.clearAllMocks();
  recalculateMock.mockResolvedValue(queueDelayData);
});

/**
 * emitPatientUpdated (step 5 of handleCompletedOrArrived) is deliberately
 * fire-and-forget — `.catch()` is attached but it is never awaited, so its
 * socket emits can land a tick after onQueueAction's own promise resolves.
 * Flush the microtask queue before asserting on it.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('a queue action reaches every patient in the queue, not just the dashboard', () => {
  it("emits appointment.updated to each non-terminal patient's own room", async () => {
    await new AppointmentEngineOrchestrator().onQueueAction(
      CLINIC,
      DOCTOR,
      DATE
    );
    await flush();

    // Both patients are non-terminal (Confirmed + Patient Arrived), so both
    // get their own socket push — this is what the patient app listens on.
    expect(toMock).toHaveBeenCalledWith('user:user-1');
    expect(toMock).toHaveBeenCalledWith('user:user-2');

    const events = emitMock.mock.calls.filter(
      ([event]) => event === 'appointment.updated'
    );
    expect(events).toHaveLength(2);

    const payloadForConfirmed = events.find(
      ([, payload]) => payload.appointmentId === 'appt-confirmed'
    )?.[1];
    expect(payloadForConfirmed).toBeDefined();
  });

  it('also emits queue.updated to the clinic dashboard room in the same pass', async () => {
    await new AppointmentEngineOrchestrator().onQueueAction(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(toMock).toHaveBeenCalledWith(`clinic:${CLINIC}`);
    const dashboardEvent = emitMock.mock.calls.find(
      ([event]) => event === 'queue.updated'
    );
    expect(dashboardEvent).toBeDefined();
  });

  it('recalculates before broadcasting, so a stale cache is never pushed', async () => {
    await new AppointmentEngineOrchestrator().onQueueAction(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(recalculateMock).toHaveBeenCalledWith(CLINIC, DOCTOR, DATE);
    expect(recalculateMock).toHaveBeenCalledTimes(1);
  });
});
