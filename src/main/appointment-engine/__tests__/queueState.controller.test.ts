/**
 * Unit test for getQueueStateController's response mapping.
 *
 * DelayTrackerService.recalculate() computes a real (non-zero)
 * estimatedWaitMinutes for a 'Confirmed' (with-the-doctor) entry when the
 * doctor started them later than their scheduled slot — that's needed
 * internally to cascade delay to whoever is behind them. But "waiting" isn't
 * a meaningful concept once a patient is already being seen, so the
 * controller's response must mask that one field to 0 for a 'Confirmed' row,
 * without touching the underlying QueueDelayData, the cascade math, or the
 * top-level cumulativeDelay figure (already computed independently).
 */

import type { QueueDelayData } from '../types/engine.types';

const getQueueDelayDataMock = jest.fn();
const recalculateMock = jest.fn();
const computeMock = jest.fn();

jest.mock('../services/delayTracker.service', () => ({
  DelayTrackerService: jest.fn().mockImplementation(() => ({
    getQueueDelayData: getQueueDelayDataMock,
    recalculate: recalculateMock,
  })),
}));

jest.mock('../services/timeToNext.service', () => ({
  TimeToNextService: jest.fn().mockImplementation(() => ({
    compute: computeMock,
  })),
}));

import { getQueueStateController } from '../controllers/queueState.controller';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

function buildQueueData(): QueueDelayData {
  return {
    clinicId: CLINIC,
    doctorId: DOCTOR,
    date: DATE,
    cumulativeDelayMinutes: 45,
    lastCalculatedAt: '2026-08-14T10:00:00.000Z',
    appointments: [
      {
        appointmentId: 'appt-confirmed',
        patientId: 'patient-1',
        userId: 'user-1',
        status: 'In Consultation',
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
        estimatedWaitMinutes: 15,
        durationMinutes: 15,
      },
    ],
  } as QueueDelayData;
}

function buildRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  getQueueDelayDataMock.mockResolvedValue(buildQueueData());
  computeMock.mockResolvedValue(12);
});

describe('getQueueStateController — Confirmed rows never expose a wait figure', () => {
  it('masks estimatedWaitMinutes to 0 for a Confirmed entry, leaves others untouched', async () => {
    const req: any = {
      query: { clinicId: CLINIC, doctorId: DOCTOR, date: DATE },
    };
    const res = buildRes();

    await getQueueStateController(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    const entries = body.data.appointments as Array<{
      appointmentId: string;
      status: string;
      estimatedWaitMinutes: number;
    }>;

    const confirmed = entries.find((e) => e.appointmentId === 'appt-confirmed');
    const waiting = entries.find((e) => e.appointmentId === 'appt-waiting');

    expect(confirmed?.estimatedWaitMinutes).toBe(0);
    expect(waiting?.estimatedWaitMinutes).toBe(15);
  });

  /**
   * A held patient's stored status stays 'Patient Arrived', so sorting on
   * status alone listed them above patients actually waiting to be seen.
   */
  it('sorts a held patient below the active queue', async () => {
    const data = buildQueueData();
    // Held, and deliberately first in the array so only the sort can move it.
    data.appointments.unshift({
      appointmentId: 'appt-held',
      patientId: 'patient-3',
      userId: 'user-3',
      status: 'Patient Arrived',
      scheduledTime: '09:30',
      tokenNo: 3,
      projectedStartTime: '09:30',
      estimatedWaitMinutes: 0,
      durationMinutes: 15,
      isOnHold: true,
      holdReason: 'held',
    } as QueueDelayData['appointments'][number]);
    getQueueDelayDataMock.mockResolvedValue(data);

    const req: any = {
      query: { clinicId: CLINIC, doctorId: DOCTOR, date: DATE },
    };
    const res = buildRes();

    await getQueueStateController(req, res, jest.fn());

    const ids = (
      res.json.mock.calls[0][0].data.appointments as Array<{
        appointmentId: string;
      }>
    ).map((e) => e.appointmentId);

    expect(ids).toEqual(['appt-confirmed', 'appt-waiting', 'appt-held']);
  });

  it('leaves the top-level cumulativeDelay untouched by the per-entry mask', async () => {
    const req: any = {
      query: { clinicId: CLINIC, doctorId: DOCTOR, date: DATE },
    };
    const res = buildRes();

    await getQueueStateController(req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.data.cumulativeDelay).toBe(45);
  });
});
