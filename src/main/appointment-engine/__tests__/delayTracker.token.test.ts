/**
 * Unit tests for DelayTrackerService.recalculate on TOKEN-BASED queues.
 *
 * Token-based appointments carry no `appointmentTime` — their slot is derived
 * from the doctor's session start plus everyone ahead of them. Before these
 * tests the whole token path was uncovered (every existing engine fixture sets
 * `tokenNo: null`), which is how the following shipped:
 *
 *  - token timelines anchored to 00:00 instead of the session start
 *  - estimatedWaitMinutes structurally pinned to 0 for token queues
 *  - real-time delay explicitly skipped for token queues
 *  - scheduledTime published as null, suppressing running-late notifications
 *  - mixed queues misclassified, giving token rows ~10-hour waits
 */

// Fix the wall clock so "the doctor is running late" is deterministic.
const mockNowHoursMinutes = { hours: 10, minutes: 0 }; // 10:00 IST

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNowHoursMinutes,
  };
});

import { ConsultationDurationService } from '../services/consultationDuration.service';
import { DelayTrackerService } from '../services/delayTracker.service';

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
  sessionIndex?: number | null;
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

/** Builds a service with the DB/Redis edges stubbed out. */
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
  mockNowHoursMinutes.minutes = 0;
});

afterEach(() => jest.restoreAllMocks());

/** A doctor-set length spaces the token grid; a learned one never does, since
 * delay is measured against this grid. */
describe('token queue — whose consultation length spaces the grid', () => {
  const threeTokens = () => [
    appt({ id: 'a', tokenNo: 1 }),
    appt({ id: 'b', tokenNo: 2 }),
    appt({ id: 'c', tokenNo: 3 }),
  ];

  it('spaces the grid by a length the doctor set, not the booking slot', async () => {
    jest
      .spyOn(ConsultationDurationService, 'resolveForDoctor')
      .mockResolvedValue({ minutes: 10, basis: 'doctor', sampleSize: 0 });

    const service = buildService({
      appointments: threeTokens(),
      slotMinutes: 30,
      sessionStartMinutes: 9 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.scheduledTime)).toEqual([
      '09:00',
      '09:10',
      '09:20',
    ]);
  });

  it('leaves the grid on the booking slot when the length was only learned', async () => {
    jest
      .spyOn(ConsultationDurationService, 'resolveForDoctor')
      .mockResolvedValue({ minutes: 10, basis: 'learned', sampleSize: 40 });

    const service = buildService({
      appointments: threeTokens(),
      slotMinutes: 30,
      sessionStartMinutes: 9 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Moving this with measured pace would hide the improvement it represents.
    expect(out.appointments.map((a) => a.scheduledTime)).toEqual([
      '09:00',
      '09:30',
      '10:00',
    ]);
  });
});

describe('token queue — scheduled times anchor to the session start', () => {
  it('spaces tokens from the session start, never from midnight', async () => {
    // Doctor is mid-consultation so real-time delay does not kick in, letting
    // us assert the raw derived schedule.
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentStatus: 'Confirmed' }),
        appt({ id: 'b', tokenNo: 2 }),
        appt({ id: 'c', tokenNo: 3 }),
      ],
      sessionStartMinutes: 9 * 60, // 09:00
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.scheduledTime)).toEqual([
      '09:00',
      '09:30',
      '10:00',
    ]);
    // The regression that started all of this:
    expect(out.appointments.map((a) => a.projectedStartTime)).not.toContain(
      '00:00'
    );
  });

  it('publishes a non-null scheduledTime so running-late can evaluate', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentStatus: 'Confirmed' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // RunningLateNotifier gates its real-time-delay branch on this field.
    expect(out.appointments[0].scheduledTime).not.toBeNull();
    expect(out.appointments[0].scheduledTime).toBe('09:00');
  });

  it('honours per-appointment duration over the slot default', async () => {
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          tokenNo: 1,
          appointmentStatus: 'Confirmed',
          appointmentDurationMinutes: '45',
        }),
        appt({ id: 'b', tokenNo: 2 }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);
    expect(out.appointments[1].scheduledTime).toBe('09:45');
  });
});

describe('token queue — real-time delay when the doctor has not started', () => {
  it('reports a real wait for the first token once the session start has passed', async () => {
    // Nobody Confirmed => doctor has not started. Now is 10:00, session 09:00.
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1 }),
        appt({ id: 'b', tokenNo: 2 }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Previously pinned to 0 for every token queue regardless of lateness.
    expect(out.appointments[0].estimatedWaitMinutes).toBe(60);
    expect(out.appointments[0].projectedStartTime).toBe('10:00');
  });

  it('cascades the delay to later tokens', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1 }),
        appt({ id: 'b', tokenNo: 2 }),
        appt({ id: 'c', tokenNo: 3 }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.projectedStartTime)).toEqual([
      '10:00',
      '10:30',
      '11:00',
    ]);
    // token2 scheduled 09:30, projected 10:30 => 60 late
    expect(out.appointments[1].estimatedWaitMinutes).toBe(60);
  });

  it('does not invent a delay before the session has started', async () => {
    mockNowHoursMinutes.hours = 8; // 08:00, before the 09:00 session
    const service = buildService({
      appointments: [appt({ id: 'a', tokenNo: 1 })],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].estimatedWaitMinutes).toBe(0);
    expect(out.appointments[0].projectedStartTime).toBe('09:00');
  });
});

describe('terminal appointments do not distort the token timeline', () => {
  it('skips cancelled tokens when spacing the ones behind them', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentStatus: 'Confirmed' }),
        appt({ id: 'b', tokenNo: 2, appointmentStatus: 'Cancelled' }),
        appt({ id: 'c', tokenNo: 3 }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // token3 follows token1 directly: 09:00 + 30 = 09:30, not 10:00.
    expect(out.appointments[2].scheduledTime).toBe('09:30');
  });

  it('never reports a terminal token as scheduled at 00:00', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentStatus: 'Cancelled' }),
        appt({ id: 'b', tokenNo: 2, appointmentStatus: 'Confirmed' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].projectedStartTime).not.toBe('00:00');
    expect(out.appointments[0].scheduledTime).toBe('09:00');
  });
});

describe('mixed queues', () => {
  it('does not push token rows to midnight when a timed row sorts first', async () => {
    // Postgres sorts NULLs last under ASC, so the timed row lands at index 0.
    const service = buildService({
      appointments: [
        appt({
          id: 'timed',
          appointmentTime: '09:00',
          appointmentStatus: 'Confirmed',
        }),
        appt({ id: 'token', tokenNo: 1 }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    const token = out.appointments[1];
    expect(token.scheduledTime).toBe('09:30');
    // The old behaviour: scheduled at midnight => ~10h of phantom wait.
    expect(token.estimatedWaitMinutes).toBeLessThan(120);
  });

  it('leaves time-based appointments behaving as before', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', appointmentTime: '09:00' }),
        appt({ id: 'b', appointmentTime: '09:30' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Doctor not started, now 10:00 => first slides to now, second cascades.
    expect(out.appointments[0].projectedStartTime).toBe('10:00');
    expect(out.appointments[0].estimatedWaitMinutes).toBe(60);
    expect(out.appointments[1].projectedStartTime).toBe('10:30');
  });
});

describe('malformed appointment times', () => {
  it('falls back to the derived slot instead of silently using midnight', async () => {
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          appointmentTime: 'not-a-time',
          appointmentStatus: 'Confirmed',
        }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 10:00, not the 09:00 derived slot: nobody is in the room (no queue
    // pointer), so a patient still waiting at 10:00 cannot be projected into
    // the past. The row being `Confirmed` means its booking was confirmed,
    // not that the doctor is with them.
    expect(out.appointments[0].projectedStartTime).toBe('10:00');
  });
});

describe('missing availability', () => {
  it('degrades without crashing when no session start is configured', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentStatus: 'Confirmed' }),
      ],
      sessionStartMinutes: null,
    });

    await expect(
      service.recalculate(CLINIC, DOCTOR, DATE)
    ).resolves.toBeDefined();
  });

  it('never invents lateness from midnight when the start time is unknown', async () => {
    // Anchored at 00:00, token 2 read ~17 hours late at 6 PM and was pushed
    // as "doctor running 16h 54min behind".
    mockNowHoursMinutes.hours = 18;
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, sessionIndex: 1 }),
        appt({ id: 'b', tokenNo: 2, sessionIndex: 1 }),
      ],
      sessionStartMinutes: null,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.projectedStartTime)).toEqual([
      '18:00',
      '18:30',
    ]);
    expect(out.appointments.map((a) => a.estimatedWaitMinutes)).toEqual([0, 0]);
  });
});

describe('placeholder appointment time on a token row', () => {
  /*
   * Some token rows carry '23:59' in `appointmentTime` rather than NULL. That
   * value parses cleanly, so it used to skip the token derivation entirely and
   * anchor the queue to 11:59 PM — surfacing as the booked time, as the
   * estimate, and as a zero delay ("On time") against a midnight nobody was
   * booked for.
   */
  it('derives the tentative slot instead of anchoring to 11:59 PM', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentTime: '23:59' }),
        appt({ id: 'b', tokenNo: 2, appointmentTime: '23:59' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.scheduledTime)).toEqual([
      '09:00',
      '09:30',
    ]);
    expect(out.appointments.map((a) => a.projectedStartTime)).not.toContain(
      '23:59'
    );
  });

  it('accepts the seconds-bearing form of the same placeholder', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1, appointmentTime: '23:59:00' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].scheduledTime).toBe('09:00');
  });

  it('does not call token 2 late when the app stored the shift start on it', async () => {
    // Mobile token bookings store the shift start, not '23:59'. Read as a slot,
    // token 2 showed 30 min late (and got a push) before the shift opened.
    mockNowHoursMinutes.hours = 8;
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          tokenNo: 1,
          sessionIndex: 1,
          appointmentTime: '09:00:00',
        }),
        appt({
          id: 'b',
          tokenNo: 2,
          sessionIndex: 1,
          appointmentTime: '09:00:00',
        }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[1].scheduledTime).toBe('09:30');
    expect(out.appointments[1].projectedStartTime).toBe('09:30');
    expect(out.appointments[1].estimatedWaitMinutes).toBe(0);
  });

  it("follows the doctor's new hours, not the shift start stored at booking", async () => {
    // Booked when the shift opened at 11:00; the doctor has since moved it to
    // 09:00. The stored 11:00 must not hold token 1 back.
    mockNowHoursMinutes.hours = 8;
    const service = buildService({
      appointments: [
        appt({
          id: 'a',
          tokenNo: 1,
          sessionIndex: 1,
          appointmentTime: '11:00:00',
          appointmentStatus: 'Patient Arrived',
        }),
      ],
      sessionStartMinutes: 9 * 60,
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].scheduledTime).toBe('09:00');
    expect(out.appointments[0].projectedStartTime).toBe('09:00');
  });

  it('walks a checked-in token 2 ahead of an absent token 1, like reception', async () => {
    mockNowHoursMinutes.hours = 8;
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1 }),
        appt({ id: 'b', tokenNo: 2, appointmentStatus: 'Patient Arrived' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Order is what the patient app counts "ahead of you" from.
    expect(out.appointments.map((a) => a.appointmentId)).toEqual(['b', 'a']);
    // Token 2 takes the opening slot; absent token 1 is behind it, not late.
    expect(out.appointments.map((a) => a.projectedStartTime)).toEqual([
      '09:00',
      '09:30',
    ]);
    expect(out.appointments[1].estimatedWaitMinutes).toBe(0);
  });

  it('keeps the time on a custom-slot token, which has no shift', async () => {
    mockNowHoursMinutes.hours = 8;
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: 1 }),
        appt({ id: 'b', tokenNo: 2, appointmentTime: '11:00' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[1].scheduledTime).toBe('11:00');
  });

  it('leaves a genuine 23:59 time-based booking alone', async () => {
    const service = buildService({
      appointments: [
        appt({ id: 'a', tokenNo: null, appointmentTime: '23:59' }),
      ],
    });

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments[0].scheduledTime).toBe('23:59');
  });
});
