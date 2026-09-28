/**
 * Unit tests for DelayTrackerService.recalculate's hold-awareness.
 *
 * Before this fix, the engine had no concept of hold at all — a held
 * appointment's DB status stays `Patient Arrived` (hold is a Redis flag
 * layered on top, not a status change), so it was walked through the
 * projected-start cascade exactly like anyone else waiting. That meant a
 * held patient's own (irrelevant) wait pushed everyone behind them later
 * than necessary, and — via liveQueueHelper's patientsAhead — everyone
 * behind them counted the held patient as "ahead", even though a paused
 * patient isn't progressing toward being seen.
 */

const mockNowHoursMinutes = { hours: 9, minutes: 5 }; // 09:05 IST

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
  getCurrentAppointmentId: jest.fn().mockResolvedValue(null),
  getHeldAppointments: jest.fn(),
  // Null on both: these tests are about holds, so the queue should project
  // exactly as it did before consultation timing existed.
  getConsultationStartedAt: jest.fn().mockResolvedValue(null),
  getConsultationEndedAt: jest.fn().mockResolvedValue(null),
}));

import { DelayTrackerService } from '../services/delayTracker.service';
import { getHeldAppointments } from '../services/queueHoldStore.service';

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
  mockNowHoursMinutes.hours = 9;
  mockNowHoursMinutes.minutes = 5;
  jest.clearAllMocks();
  (getHeldAppointments as jest.Mock).mockResolvedValue(new Map());
});

afterEach(() => jest.restoreAllMocks());

describe('recalculate() excludes a held appointment from the projected-start cascade', () => {
  it('does not push the appointment behind a held one later, and marks the held entry', async () => {
    (getHeldAppointments as jest.Mock).mockResolvedValue(
      new Map([['b', 'held']])
    );

    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:15' }),
        appt({ id: 'c', appointmentTime: '09:30' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    // By id: a held patient sorts after the waiting ones, as on the board.
    const byId = (id: string) =>
      out.appointments.find((e) => e.appointmentId === id)!;
    const [a, b, c] = [byId('a'), byId('b'), byId('c')];

    // 'a' is realtime-delayed (now 09:05 > scheduled 09:00), ends at 09:35.
    expect(a.projectedStartTime).toBe('09:05');
    expect(a.estimatedWaitMinutes).toBe(5);

    // 'b' is held: no live projection, no wait, flagged.
    expect(b.isOnHold).toBe(true);
    expect(b.holdReason).toBe('held');
    expect(b.estimatedWaitMinutes).toBe(0);
    expect(b.projectedStartTime).toBe('09:15');

    // 'c' cascades from 'a' directly (09:35), NOT from 'b' — if the held
    // entry had been included in the cascade, 'c' would land at 10:05
    // instead (09:15 pushed to 09:35 by 'a', +30min duration = 10:05).
    expect(c.projectedStartTime).toBe('09:35');
    expect(c.estimatedWaitMinutes).toBe(5);
    expect(c.isOnHold).toBeFalsy();
  });

  /**
   * A held patient carries no live estimate — resuming has no scheduled
   * moment. The row keeps its anchor and zero wait; `isOnHold` is what tells
   * the client not to render it as an estimate.
   */
  it('reports no wait for a held patient whose slot has passed', async () => {
    mockNowHoursMinutes.hours = 11;
    mockNowHoursMinutes.minutes = 12;
    (getHeldAppointments as jest.Mock).mockResolvedValue(
      new Map([['b', 'held']])
    );

    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '10:00' }),
      ],
    });

    const [, b] = (await service.recalculate(CLINIC, DOCTOR, DATE))
      .appointments;

    expect(b.isOnHold).toBe(true);
    expect(b.estimatedWaitMinutes).toBe(0);
  });

  it('cumulativeDelayMinutes reflects the last active entry, not a trailing held one', async () => {
    (getHeldAppointments as jest.Mock).mockResolvedValue(
      new Map([['b', 'held']])
    );

    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:15' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 'b' (held, last in the array) must not leave cumulativeDelayMinutes at
    // its own 0 — it should still reflect 'a', the last *active* entry.
    expect(out.cumulativeDelayMinutes).toBe(5);
  });

  it('a non-held appointment is unaffected and explicitly marked isOnHold: false', async () => {
    const service = buildService({
      appointments: [appt({ id: 'a', appointmentTime: '09:00' })],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].isOnHold).toBe(false);
    expect(out.appointments[0].holdReason).toBeUndefined();
  });
});
