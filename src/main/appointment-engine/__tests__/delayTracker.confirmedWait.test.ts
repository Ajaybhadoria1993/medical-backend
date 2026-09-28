/**
 * Guards the internal/response boundary behind the queue-state 'Confirmed'
 * wait-time fix (queueState.controller.ts).
 *
 * DelayTrackerService.recalculate() must keep computing a real, non-zero
 * estimatedWaitMinutes for the in-room ('Confirmed') appointment when the
 * doctor started them later than scheduled — that value is what
 * cumulativeDelayMinutes/previousProjectedEnd cascade to everyone behind
 * them. Only the HTTP response layer (queueState.controller.ts) masks it to
 * 0 for display. If a future change "fixes" the confusing wait figure by
 * zeroing it inside recalculate() itself instead, the cascade breaks
 * silently — this test exists to catch that.
 */

const mockNowHoursMinutes = { hours: 10, minutes: 30 }; // 10:30 IST

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNowHoursMinutes,
  };
});

jest.mock('../services/queueHoldStore.service', () => ({
  // Reception's promotions, which the projection now walks in the same order.
  getNextAppointmentIds: jest.fn().mockResolvedValue([]),
  getCurrentAppointmentId: jest.fn(),
  getHeldAppointments: jest.fn().mockResolvedValue(new Map()),
  // The consultation clock the tracker reads once someone is in the room.
  // Null leaves the projection anchored to the booked time, which is what
  // every case here wants: these tests are about the wait figure, not about
  // a real-time overrun.
  getConsultationStartedAt: jest.fn().mockResolvedValue(null),
  getConsultationEndedAt: jest.fn().mockResolvedValue(null),
}));

import { DelayTrackerService } from '../services/delayTracker.service';
import {
  getConsultationStartedAt,
  getCurrentAppointmentId,
} from '../services/queueHoldStore.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

type Appt = {
  id: string;
  patientId: string;
  appointmentStatus: string;
  appointmentTime: string | null;
  tokenNo: number | null;
  appointmentDurationMinutes: string | null;
};

function appt(over: Partial<Appt> & { id: string }): Appt {
  return {
    patientId: `p-${over.id}`,
    appointmentStatus: 'Patient Arrived',
    appointmentTime: null,
    tokenNo: null,
    appointmentDurationMinutes: null,
    ...over,
  };
}

function buildService(opts: {
  appointments: Appt[];
  slotMinutes?: number | null;
  sessionStartMinutes?: number | null;
}) {
  const service = new DelayTrackerService();

  jest
    .spyOn(service as any, 'fetchDailyQueue')
    .mockResolvedValue(opts.appointments);
  jest.spyOn(service as any, 'resolveDayConfig').mockResolvedValue({
    slotMinutes: opts.slotMinutes ?? 30,
    sessionStartMinutes:
      opts.sessionStartMinutes === undefined
        ? 9 * 60
        : opts.sessionStartMinutes,
  });
  jest.spyOn(service as any, 'storeInRedis').mockResolvedValue(undefined);

  return service;
}

beforeEach(() => {
  mockNowHoursMinutes.hours = 10;
  mockNowHoursMinutes.minutes = 30;
  jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

describe("recalculate() keeps a real estimatedWaitMinutes for the in-room 'Confirmed' entry", () => {
  it('keeps the in-room patient late when the doctor took them in after their slot', async () => {
    // 'y' (09:15) is the one the room pointer names, taken in well after its
    // slot. The walk follows the board, so the in-room patient comes first and
    // 'x' waits behind them; y's own lateness must survive into the figure.
    (getCurrentAppointmentId as jest.Mock).mockResolvedValue('y');
    (getConsultationStartedAt as jest.Mock).mockResolvedValue(
      '2026-08-14T05:00:00.000Z'
    );

    const service = buildService({
      appointments: [
        appt({ id: 'x', appointmentTime: '09:00' }),
        appt({
          id: 'y',
          appointmentTime: '09:15',
          appointmentStatus: 'Confirmed',
        }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const inRoom = out.appointments.find((a) => a.appointmentId === 'y');

    expect(inRoom?.status).toBe('In Consultation');
    // This is the exact figure queueState.controller.ts masks to 0 in the
    // HTTP response — the raw engine output must still carry it.
    expect(inRoom?.estimatedWaitMinutes).toBeGreaterThan(0);
  });
});
