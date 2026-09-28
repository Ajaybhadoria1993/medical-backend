/**
 * Unit test for the `position` field on emitQueueUpdated's dashboard payload.
 *
 * Position is a 1-based rank among appointments actually progressing toward
 * being seen — array order is already queue order, this just numbers it
 * explicitly instead of leaving the dashboard to infer it from array index.
 * Terminal (done) and held/skipped (paused) entries get no position; the
 * patient currently with the doctor still counts as position 1.
 */

const emitMock = jest.fn();
const toMock = jest.fn(() => ({ emit: emitMock }));
const inMock = jest.fn(() => ({
  fetchSockets: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../app', () => ({
  socketManager: { io: { to: toMock, in: inMock } },
}));

import { QueueBroadcastService } from '../services/queueBroadcast.service';
import type {
  QueueDelayData,
  AppointmentDelayEntry,
} from '../types/engine.types';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

function entry(
  over: Partial<AppointmentDelayEntry> & { appointmentId: string }
): AppointmentDelayEntry {
  return {
    patientId: `p-${over.appointmentId}`,
    userId: `u-${over.appointmentId}`,
    status: 'Patient Arrived',
    scheduledTime: '09:00',
    tokenNo: null,
    projectedStartTime: '09:00',
    estimatedWaitMinutes: 0,
    durationMinutes: 15,
    isOnHold: false,
    ...over,
  };
}

function buildQueueData(appointments: AppointmentDelayEntry[]): QueueDelayData {
  return {
    clinicId: CLINIC,
    doctorId: DOCTOR,
    date: DATE,
    cumulativeDelayMinutes: 0,
    lastCalculatedAt: '2026-08-14T09:05:00.000Z',
    appointments,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('emitQueueUpdated — position field', () => {
  it('numbers the in-room patient 1 and counts up, skipping held/terminal entries', () => {
    const queueData = buildQueueData([
      entry({ appointmentId: 'cur', status: 'Confirmed' }),
      entry({ appointmentId: 'held1', isOnHold: true, holdReason: 'held' }),
      entry({ appointmentId: 'wait1' }),
      entry({ appointmentId: 'done1', status: 'Completed' }),
      entry({ appointmentId: 'wait2' }),
    ]);

    new QueueBroadcastService().emitQueueUpdated(CLINIC, queueData);

    const [, payload] = emitMock.mock.calls.find(
      ([event]) => event === 'queue.updated'
    )!;
    const byId = new Map(
      payload.appointments.map(
        (a: { appointmentId: string; position: number | null }) => [
          a.appointmentId,
          a.position,
        ]
      )
    );

    expect(byId.get('cur')).toBe(1);
    expect(byId.get('held1')).toBeNull();
    expect(byId.get('wait1')).toBe(2);
    expect(byId.get('done1')).toBeNull();
    expect(byId.get('wait2')).toBe(3);
  });
});
