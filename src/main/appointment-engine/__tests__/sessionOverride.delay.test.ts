/**
 * Unit tests for the staff-announced "running late" override as it reaches
 * DelayTrackerService.recalculate.
 *
 * The override is applied as a *floor* on the first live appointment's
 * projected start, never as a replacement — so the number a patient sees is
 * always the worse of "what reception announced" and "what the clock actually
 * shows". These tests pin that down, plus the cascade to everyone behind,
 * because getting it backwards would quote patients a better time than reality
 * supports, which is exactly the failure the feature exists to prevent.
 */

// Fix the wall clock so "the doctor is running late" is deterministic.
const mockNowHoursMinutes = { hours: 9, minutes: 0 }; // 09:00 IST

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNowHoursMinutes,
  };
});

import { DelayTrackerService } from '../services/delayTracker.service';
import { SessionOverrideService } from '../services/sessionOverride.service';

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
    appointmentStatus: 'Upcoming',
    appointmentTime: null,
    tokenNo: null,
    appointmentDurationMinutes: null,
    ...over,
  };
}

function buildService(opts: {
  appointments: Appt[];
  announcedMinutes: number;
  slotMinutes?: number;
  sessionStartMinutes?: number;
}) {
  const service = new DelayTrackerService();

  jest
    .spyOn(service as any, 'fetchDailyQueue')
    .mockResolvedValue(opts.appointments);
  jest.spyOn(service as any, 'resolveDayConfig').mockResolvedValue({
    slotMinutes: opts.slotMinutes ?? 30,
    sessionStartMinutes: opts.sessionStartMinutes ?? 9 * 60,
  });
  jest.spyOn(service as any, 'storeInRedis').mockResolvedValue(undefined);
  jest
    .spyOn(SessionOverrideService, 'getActiveMinutes')
    .mockResolvedValue(opts.announcedMinutes);

  return service;
}

const waits = (out: {
  appointments: Array<{ estimatedWaitMinutes: number }>;
}) => out.appointments.map((a) => a.estimatedWaitMinutes);

beforeEach(() => {
  mockNowHoursMinutes.hours = 9;
  mockNowHoursMinutes.minutes = 0;
});

afterEach(() => jest.restoreAllMocks());

describe('announced running-late delay', () => {
  it('has no effect when nothing was announced', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:30' }),
      ],
      announcedMinutes: 0,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(waits(out)).toEqual([0, 0]);
    expect(out.cumulativeDelayMinutes).toBe(0);
  });

  it('delays the first appointment by the announced amount', async () => {
    const service = buildService({
      appointments: [appt({ id: 'a', appointmentTime: '09:00' })],
      announcedMinutes: 30,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(waits(out)).toEqual([30]);
    expect(out.appointments[0].projectedStartTime).toBe('09:30');
  });

  it('cascades the announced delay to everyone behind', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:30' }),
        appt({ id: 'c', appointmentTime: '10:00' }),
      ],
      announcedMinutes: 30,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 09:00 slips to 09:30 and runs 30 minutes, pushing 09:30 to 10:00, and so
    // on — the whole queue moves by the announced amount, not just the first.
    expect(waits(out)).toEqual([30, 30, 30]);
    expect(out.appointments.map((a) => a.projectedStartTime)).toEqual([
      '09:30',
      '10:00',
      '10:30',
    ]);
  });

  it('never quotes better than the measured delay when the doctor is running worse', async () => {
    // Announced 15 minutes, but it is already 10:00 and the 09:00 patient has
    // not been seen — the real delay is 60. The patient must be told 60.
    mockNowHoursMinutes.hours = 10;

    const service = buildService({
      appointments: [appt({ id: 'a', appointmentTime: '09:00' })],
      announcedMinutes: 15,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(waits(out)).toEqual([60]);
  });

  it('still applies while the doctor is consulting', async () => {
    // A Confirmed appointment means the doctor is with a patient, which
    // suppresses the clock-based delay branch. The announced value is the only
    // signal left, so it must survive that branch rather than being skipped.
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          appointmentTime: '09:00',
          appointmentStatus: 'Confirmed',
        }),
        appt({ id: 'b', appointmentTime: '09:30' }),
      ],
      announcedMinutes: 20,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(waits(out)).toEqual([20, 20]);
  });

  it('applies to token queues, which carry no stored time', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1 }),
        appt({ id: 'b', tokenNo: 2 }),
      ],
      announcedMinutes: 45,
      sessionStartMinutes: 9 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(waits(out)).toEqual([45, 45]);
    expect(out.appointments.map((a) => a.projectedStartTime)).toEqual([
      '09:45',
      '10:15',
    ]);
  });

  it('ignores terminal appointments when applying the floor', async () => {
    // The cancelled row must not absorb the announcement and leave the real
    // first patient showing no delay.
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          appointmentTime: '09:00',
          appointmentStatus: 'Cancelled',
        }),
        appt({ id: 'b', appointmentTime: '09:30' }),
      ],
      announcedMinutes: 30,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].estimatedWaitMinutes).toBe(0); // cancelled
    expect(out.appointments[1].estimatedWaitMinutes).toBe(30);
  });
});
