/**
 * Unit tests for split shifts (a doctor working morning AND evening).
 *
 * A split shift exists only as two available
 * `clinic_date_availability_time_slots` rows. Nothing else records the gap
 * between them: the weekly availability table is unique on
 * (clinic, day, doctor) so it cannot hold two shifts, and the break rows
 * describe the weekly row rather than a specific date's slots.
 *
 * Before `deriveWindowGaps` the engine never turned that gap into a break, so
 * the projection walked straight through the afternoon: an evening token was
 * projected into the early afternoon, and since wait time is
 * `projected - scheduled`, every evening patient reported hours of delay and
 * tripped running-late notifications while the doctor was perfectly on time.
 */

// Fix the clock inside the morning session so real-time lateness never
// interferes with what these tests assert.
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
import { deriveWindowGaps, normalizeBreaks } from '../utils/helpers';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

/** 09:00–13:00 morning, 17:00–21:00 evening. */
const MORNING = { start: 9 * 60, end: 13 * 60 };
const EVENING = { start: 17 * 60, end: 21 * 60 };

type Appt = {
  id: string;
  patientId: string;
  appointmentStatus: string;
  appointmentTime: string | null;
  tokenNo: number | null;
  sessionIndex: number | null;
  appointmentDurationMinutes: string | null;
};

function appt(over: Partial<Appt> & { id: string }): Appt {
  return {
    patientId: `p-${over.id}`,
    appointmentStatus: 'Upcoming',
    appointmentTime: null,
    tokenNo: null,
    sessionIndex: null,
    appointmentDurationMinutes: null,
    ...over,
  };
}

function buildService(opts: {
  appointments: Appt[];
  breaks?: Array<{ startMinutes: number; endMinutes: number }>;
  slotMinutes?: number;
  sessionStartMinutes?: number;
  /** Omitted by default: without it the last sitting has no closing minute. */
  sessionEndMinutes?: number;
}) {
  const service = new DelayTrackerService();

  jest
    .spyOn(service as any, 'fetchDailyQueue')
    .mockResolvedValue(opts.appointments);
  jest.spyOn(service as any, 'resolveDayConfig').mockResolvedValue({
    slotMinutes: opts.slotMinutes ?? 30,
    sessionStartMinutes: opts.sessionStartMinutes ?? 9 * 60,
    sessionEndMinutes: opts.sessionEndMinutes,
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

describe('deriveWindowGaps', () => {
  it('returns nothing for a single continuous shift', () => {
    expect(deriveWindowGaps([MORNING])).toEqual([]);
  });

  it('returns nothing when the doctor is not scheduled at all', () => {
    expect(deriveWindowGaps([])).toEqual([]);
  });

  it('turns the gap between two shifts into a break', () => {
    expect(deriveWindowGaps([MORNING, EVENING])).toEqual([
      { startMinutes: 13 * 60, endMinutes: 17 * 60 },
    ]);
  });

  it('sorts before deriving, so slot order in the table does not matter', () => {
    // The rows come back unordered and a clinic may define the evening first.
    expect(deriveWindowGaps([EVENING, MORNING])).toEqual([
      { startMinutes: 13 * 60, endMinutes: 17 * 60 },
    ]);
  });

  it('derives a gap per pair across three shifts', () => {
    const midday = { start: 14 * 60, end: 15 * 60 };
    expect(deriveWindowGaps([MORNING, midday, EVENING])).toEqual([
      { startMinutes: 13 * 60, endMinutes: 14 * 60 },
      { startMinutes: 15 * 60, endMinutes: 17 * 60 },
    ]);
  });

  it('yields no gap for touching shifts', () => {
    expect(
      deriveWindowGaps([MORNING, { start: 13 * 60, end: 17 * 60 }])
    ).toEqual([]);
  });

  it('yields no gap for overlapping or nested shifts', () => {
    // Never a negative window, which would shift a projection backwards.
    expect(
      deriveWindowGaps([MORNING, { start: 11 * 60, end: 15 * 60 }])
    ).toEqual([]);
    expect(
      deriveWindowGaps([MORNING, { start: 10 * 60, end: 11 * 60 }])
    ).toEqual([]);
  });

  it('merges cleanly with a weekly lunch break rather than double-counting', () => {
    // The service pushes derived gaps in beside the weekly breaks and lets
    // normalizeBreaks reconcile them.
    const lunch = { startMinutes: 12 * 60, endMinutes: 13 * 60 };
    const merged = normalizeBreaks([
      lunch,
      ...deriveWindowGaps([MORNING, EVENING]),
    ]);

    expect(merged).toEqual([{ startMinutes: 12 * 60, endMinutes: 17 * 60 }]);
  });
});

describe('projection across a split shift', () => {
  it('projects an evening token into the evening, not the afternoon gap', async () => {
    // Ten 30-minute tokens. The morning shift (09:00–13:00) holds exactly
    // eight, so tokens 9 and 10 must cross into the evening rather than being
    // projected into the closed 13:00–17:00 gap.
    const appointments = Array.from({ length: 10 }, (_, i) =>
      appt({ id: `a${i + 1}`, tokenNo: i + 1 })
    );

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Morning shift runs 09:00 onward, half-hourly, up to the 12:30 slot.
    expect(out.appointments[0].projectedStartTime).toBe('09:00');
    expect(out.appointments[7].projectedStartTime).toBe('12:30');
    // The overflow lands at the start of the evening shift, not at 13:00.
    expect(out.appointments[8].projectedStartTime).toBe('17:00');
    expect(out.appointments[9].projectedStartTime).toBe('17:30');

    // The token that crosses the boundary resumes at the evening start
    // rather than continuing through the closed hours.
    const crossing = out.appointments.find(
      (a) => a.projectedStartTime === '17:00'
    );
    expect(crossing).toBeDefined();

    // Nothing may be projected inside the gap at all.
    const insideGap = out.appointments.filter((a) => {
      const [h, m] = (a.projectedStartTime ?? '00:00').split(':').map(Number);
      const mins = h * 60 + m;
      return mins >= 13 * 60 && mins < 17 * 60;
    });
    expect(insideGap).toHaveLength(0);
  });

  it('reports no delay for evening patients when the doctor is on time', async () => {
    // The regression: the gap must move BOTH the projection and the nominal
    // token schedule, or the whole 4-hour break reads as accumulated delay.
    const appointments = Array.from({ length: 10 }, (_, i) =>
      appt({ id: `a${i + 1}`, tokenNo: i + 1 })
    );

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    for (const entry of out.appointments) {
      expect(entry.estimatedWaitMinutes).toBe(0);
    }
    expect(out.cumulativeDelayMinutes).toBe(0);
  });
});

/**
 * Shift-wise token numbering: each session runs its own 1..N, so the same
 * token number exists once per shift. The tests above cover the older model
 * where one continuous run of tokens overflows from one shift into the next
 * (`sessionIndex` null); these cover a day whose tokens are numbered per
 * session, which is what a doctor configured with per-shift capacities gets.
 */
describe('projection with per-session token numbering', () => {
  it("schedules a second session's token 1 at that session's own start", async () => {
    // Two tokens in the morning, two in the evening — each shift numbered
    // from 1. The evening's token 1 must open the evening shift at 17:00,
    // not inherit 09:00 from the morning: with nothing ahead of it in its
    // own session there is no accumulated duration to carry it there, so
    // seeding from the day's start is what put it at 09:30.
    const appointments = [
      appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
      appt({ id: 'm2', tokenNo: 2, sessionIndex: 1 }),
      appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
      appt({ id: 'e2', tokenNo: 2, sessionIndex: 2 }),
    ];

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const byId = new Map(out.appointments.map((a) => [a.appointmentId, a]));

    expect(byId.get('m1')?.scheduledTime).toBe('09:00');
    expect(byId.get('m2')?.scheduledTime).toBe('09:30');
    // The evening session restarts at its own opening time.
    expect(byId.get('e1')?.scheduledTime).toBe('17:00');
    expect(byId.get('e2')?.scheduledTime).toBe('17:30');
  });

  it('does not carry a late morning session into the evening session', async () => {
    // The doctor is running two hours behind at 11:00 with the morning
    // session untouched. That lateness belongs to the morning: the evening
    // shift has its own start and is still hours away.
    mockNowHoursMinutes.hours = 11;
    mockNowHoursMinutes.minutes = 0;

    const appointments = [
      appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
      appt({ id: 'm2', tokenNo: 2, sessionIndex: 1 }),
      appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
    ];

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const byId = new Map(out.appointments.map((a) => [a.appointmentId, a]));

    // The morning really is late — the clock has passed its slots.
    expect(byId.get('m1')?.estimatedWaitMinutes).toBeGreaterThan(0);

    // The evening opens on time regardless.
    expect(byId.get('e1')?.projectedStartTime).toBe('17:00');
    expect(byId.get('e1')?.estimatedWaitMinutes).toBe(0);
  });

  it('spends the gap on an unseen morning, without taking the next shift’s hours', async () => {
    // 14:20: the morning has closed with nobody seen, but the evening does not
    // open until 17:00 — those hours belong to nobody, so the overrun uses them.
    mockNowHoursMinutes.hours = 14;
    mockNowHoursMinutes.minutes = 20;

    const appointments = [
      appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
      appt({ id: 'm2', tokenNo: 2, sessionIndex: 1 }),
      appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
    ];

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const byId = new Map(out.appointments.map((a) => [a.appointmentId, a]));

    expect(byId.get('m1')?.isMissedSession).toBeFalsy();
    expect(byId.get('m2')?.isMissedSession).toBeFalsy();

    // Real times in the gap, each its own — three identical ones read as a bug.
    expect(byId.get('m1')?.projectedStartTime).toBe('14:20');
    expect(byId.get('m2')?.projectedStartTime).toBe('14:50');

    // Never the evening's opening minute, which its own token 1 holds.
    expect(byId.get('e1')?.projectedStartTime).toBe('17:00');
    expect(byId.get('e1')?.isMissedSession).toBeFalsy();

    // Still counting down, because there is still a turn to wait for.
    const { buildPayloadFromQueue } =
      await import('../services/liveQueueHelper');
    const morning = buildPayloadFromQueue('m1', out);
    expect(morning.isMissedSession).toBe(false);
    expect(morning.tentativeStartTime).toBe('14:20');

    const evening = buildPayloadFromQueue('e1', out);
    expect(evening.isMissedSession).toBe(false);
    expect(evening.tentativeStartTime).toBe('17:00');
  });

  it("counts only the same session's patients as ahead of an evening token", async () => {
    const appointments = [
      appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
      appt({ id: 'm2', tokenNo: 2, sessionIndex: 1 }),
      appt({ id: 'm3', tokenNo: 3, sessionIndex: 1 }),
      appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
      appt({ id: 'e2', tokenNo: 2, sessionIndex: 2 }),
    ];

    const service = buildService({
      appointments,
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const queueData = await service.recalculate(CLINIC, DOCTOR, DATE);

    const { buildPayloadFromQueue } =
      await import('../services/liveQueueHelper');

    // Second in the evening session: one patient ahead, not four.
    const evening = buildPayloadFromQueue('e2', queueData);
    expect(evening.queue.patientsAhead).toBe(1);
    expect(evening.queue.position).toBe(2);
    expect(evening.sessionIndex).toBe(2);

    // The morning is unaffected and still ranks within itself.
    const morning = buildPayloadFromQueue('m3', queueData);
    expect(morning.queue.patientsAhead).toBe(2);
    expect(morning.queue.position).toBe(3);
    expect(morning.sessionIndex).toBe(1);
  });
});

/**
 * The hours between two sittings belong to nobody until the next one opens, so
 * a doctor who is in the building and behind may still use them.
 */
describe('overrunning into the gap between sittings', () => {
  it('keeps a late morning token running rather than calling it missed', async () => {
    // 14:00: past the morning's 13:00 close, an hour before the evening opens.
    mockNowHoursMinutes.hours = 14;
    mockNowHoursMinutes.minutes = 0;

    const service = buildService({
      appointments: [
        appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
        appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
      ],
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const byId = new Map(out.appointments.map((a) => [a.appointmentId, a]));

    expect(byId.get('m1')?.isMissedSession).toBeFalsy();
    expect(byId.get('m1')?.projectedStartTime).toBe('14:00');
    // The evening still opens on its own hour, untouched by the overrun.
    expect(byId.get('e1')?.projectedStartTime).toBe('17:00');
  });

  it('calls it missed once the next sitting has opened', async () => {
    mockNowHoursMinutes.hours = 17;
    mockNowHoursMinutes.minutes = 30;

    const service = buildService({
      appointments: [
        appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 }),
        appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 }),
      ],
      breaks: deriveWindowGaps([MORNING, EVENING]),
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    const byId = new Map(out.appointments.map((a) => [a.appointmentId, a]));

    // Those hours are spoken for now — they belong to the evening's own tokens.
    expect(byId.get('m1')?.isMissedSession).toBe(true);
    expect(byId.get('e1')?.isMissedSession).toBeFalsy();
  });

  it('never marks the last sitting missed, even past its own end', async () => {
    // Nothing follows the evening, so an overrun has no one to collide with.
    mockNowHoursMinutes.hours = 21;
    mockNowHoursMinutes.minutes = 30;

    const service = buildService({
      appointments: [appt({ id: 'e1', tokenNo: 1, sessionIndex: 2 })],
      breaks: deriveWindowGaps([MORNING, EVENING]),
      sessionEndMinutes: 21 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].isMissedSession).toBeFalsy();
  });

  it('never marks a single-shift day missed, even past its end', async () => {
    mockNowHoursMinutes.hours = 21;
    mockNowHoursMinutes.minutes = 30;

    const service = buildService({
      appointments: [appt({ id: 'm1', tokenNo: 1, sessionIndex: 1 })],
      breaks: [],
      sessionEndMinutes: 13 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].isMissedSession).toBeFalsy();
  });
});
