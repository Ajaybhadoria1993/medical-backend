/**
 * Unit tests for doctor breaks in the queue projection.
 *
 * The subtle requirement is that breaks move BOTH sides of the wait-time
 * calculation. Wait time is `projected - scheduled`; if the projection stepped
 * over lunch but the nominal token schedule did not, every afternoon patient
 * would report the entire lunch break as delay and trigger a running-late
 * notification, while the doctor was perfectly on time.
 */

// Fix the clock inside the morning session so real-time lateness never
// interferes with what these tests are asserting.
const mockNowHoursMinutes = { hours: 9, minutes: 0 };

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNowHoursMinutes,
  };
});

import { DelayTrackerService } from '../services/delayTracker.service';
import { SessionOverrideService } from '../services/sessionOverride.service';
import { ConsultationDurationService } from '../services/consultationDuration.service';
import { normalizeBreaks, shiftPastBreaks } from '../utils/helpers';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

/** 13:00–14:00 lunch. */
const LUNCH = [{ startMinutes: 13 * 60, endMinutes: 14 * 60 }];

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
  breaks?: Array<{ startMinutes: number; endMinutes: number }>;
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
    breaks: opts.breaks ?? [],
  });
  jest.spyOn(service as any, 'storeInRedis').mockResolvedValue(undefined);
  jest.spyOn(SessionOverrideService, 'getActiveMinutes').mockResolvedValue(0);
  jest
    .spyOn(ConsultationDurationService, 'resolveForDoctor')
    .mockResolvedValue({ minutes: null, basis: 'slot', sampleSize: 0 });

  return service;
}

beforeEach(() => {
  mockNowHoursMinutes.hours = 9;
  mockNowHoursMinutes.minutes = 0;
});

afterEach(() => jest.restoreAllMocks());

describe('shiftPastBreaks', () => {
  it('leaves a time outside every break alone', () => {
    expect(shiftPastBreaks(12 * 60, LUNCH)).toBe(12 * 60);
    expect(shiftPastBreaks(15 * 60, LUNCH)).toBe(15 * 60);
  });

  it('moves a time inside a break to its end', () => {
    expect(shiftPastBreaks(13 * 60 + 20, LUNCH)).toBe(14 * 60);
  });

  it('treats the break end as already clear', () => {
    // Half-open window: a consultation may begin exactly when lunch ends.
    expect(shiftPastBreaks(14 * 60, LUNCH)).toBe(14 * 60);
  });

  it('walks back-to-back breaks rather than shifting once', () => {
    // Landing in the first break moves into the second, which must also apply.
    const breaks = [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 660, endMinutes: 700 },
    ];
    expect(shiftPastBreaks(610, breaks)).toBe(700);
  });

  it('is a no-op with no breaks configured', () => {
    expect(shiftPastBreaks(13 * 60 + 20, [])).toBe(13 * 60 + 20);
  });
});

describe('normalizeBreaks', () => {
  it('drops incomplete and inverted windows', () => {
    expect(
      normalizeBreaks([
        { startMinutes: null, endMinutes: 600 },
        { startMinutes: 600, endMinutes: null },
        { startMinutes: 700, endMinutes: 700 },
        { startMinutes: 800, endMinutes: 700 },
      ])
    ).toEqual([]);
  });

  it('merges overlapping windows so the same lunch is not counted twice', () => {
    // The inline breaksStart/breaksEnd pair and a typed break row commonly
    // describe the same lunch break.
    expect(
      normalizeBreaks([
        { startMinutes: 780, endMinutes: 840 },
        { startMinutes: 800, endMinutes: 860 },
      ])
    ).toEqual([{ startMinutes: 780, endMinutes: 860 }]);
  });

  it('sorts windows given out of order', () => {
    expect(
      normalizeBreaks([
        { startMinutes: 900, endMinutes: 930 },
        { startMinutes: 600, endMinutes: 630 },
      ])
    ).toEqual([
      { startMinutes: 600, endMinutes: 630 },
      { startMinutes: 900, endMinutes: 930 },
    ]);
  });
});

describe('breaks in the projection', () => {
  it('pushes a time-based appointment starting inside a break to after it', async () => {
    const service = buildService({
      appointments: [appt({ id: 'a', appointmentTime: '13:15' })],
      breaks: LUNCH,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].projectedStartTime).toBe('14:00');
    expect(out.appointments[0].estimatedWaitMinutes).toBe(45);
  });

  it('leaves a queue that never touches a break unchanged', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:30' }),
      ],
      breaks: LUNCH,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.estimatedWaitMinutes)).toEqual([0, 0]);
  });

  it('does not report lunch as delay on a token queue', async () => {
    // The regression this guards: eight 30-minute tokens from 09:00 run
    // 09:00…12:30, then the ninth would nominally start at 13:00 — inside
    // lunch. Both the nominal slot and the projection must step over it, so the
    // patient is told 14:00 with NO delay, rather than 14:00 with 60 minutes of
    // "delay" that would notify them the doctor is running an hour late.
    const appointments = Array.from({ length: 9 }, (_, i) =>
      appt({ id: `t${i + 1}`, tokenNo: i + 1 })
    );

    const service = buildService({
      appointments,
      breaks: LUNCH,
      sessionStartMinutes: 9 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    const ninth = out.appointments[8];
    expect(ninth.scheduledTime).toBe('14:00');
    expect(ninth.projectedStartTime).toBe('14:00');
    expect(ninth.estimatedWaitMinutes).toBe(0);
    expect(out.cumulativeDelayMinutes).toBe(0);
  });

  it('still reports a real delay on top of a break', async () => {
    // A genuine delay must survive the break handling — the break absorbs its
    // own duration, not the doctor's lateness.
    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '12:45' }),
        appt({ id: 'b', appointmentTime: '13:30' }),
      ],
      breaks: LUNCH,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 'a' runs 12:45–13:15; 'b' is scheduled 13:30 (inside lunch) so it moves
    // to 14:00 — 30 minutes later than its slot.
    expect(out.appointments[1].projectedStartTime).toBe('14:00');
    expect(out.appointments[1].estimatedWaitMinutes).toBe(30);
  });
});
