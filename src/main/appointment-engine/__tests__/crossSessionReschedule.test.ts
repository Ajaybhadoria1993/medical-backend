/**
 * Unit tests for the session an appointment carries after being moved.
 *
 * A token and a session only mean something together: numbering restarts at 1
 * in every shift, so token 3 exists twice on a split-shift day. Moving an
 * appointment to another date, or onto another token, can land it in a
 * different shift — and carrying the old `sessionIndex` across would tag a
 * morning number as sitting in the evening queue, where it collides with that
 * shift's own token 3.
 *
 * `updateAppointment` therefore recomputes the session rather than trusting
 * what the caller passed, or what the row already held.
 */

const mockNow = { hours: 10, minutes: 0 };

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNow,
    getISTDateString: () => '2026-08-14',
  };
});

import { TokenSessionService } from '../services/tokenSession.service';
import { ScheduleShiftService } from '../services/scheduleShift.service';
import { TokenCapacityService } from '../services/tokenCapacity.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const TODAY = '2026-08-14';
const FUTURE = '2026-08-21';

/** 09:00-13:00 morning, 17:00-21:00 evening. */
const SPLIT = [
  { start: 9 * 60, end: 13 * 60 },
  { start: 17 * 60, end: 21 * 60 },
];

function stubDay(segments: Array<{ start: number; end: number }>) {
  jest
    .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
    .mockResolvedValue({
      source: 'weekly',
      slotMinutes: null,
      stepMinutes: null,
      segments,
    });

  jest
    .spyOn(TokenCapacityService, 'resolveForSession')
    .mockResolvedValue({ capacity: 20, source: 'weekly' });
}

const anyExecutor = {} as never;

beforeEach(() => {
  mockNow.hours = 10;
  mockNow.minutes = 0;
});

afterEach(() => jest.restoreAllMocks());

describe('the session an appointment lands in after a move', () => {
  it('re-derives the session instead of keeping the stored one', async () => {
    // The row was booked in the morning. Moved to 18:00 on the same day, it
    // belongs to the evening — keeping sessionIndex 1 would leave a morning tag
    // on an evening appointment.
    mockNow.hours = 18;
    stubDay(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY
    );

    expect(session.sessionIndex).toBe(2);
  });

  it('honours an explicit session over inference', async () => {
    // Staff moving someone into a named shift must not be second-guessed by
    // the clock.
    mockNow.hours = 10;
    stubDay(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY,
      2
    );

    expect(session.sessionIndex).toBe(2);
    expect(session.sessionStart).toBe('17:00');
  });

  it('refuses to guess when moving to a future split-shift day', async () => {
    // A future date carries no clock to infer from, so a move that does not
    // name its session is rejected rather than landing somewhere arbitrary.
    stubDay(SPLIT);

    await expect(
      TokenSessionService.resolve(anyExecutor, CLINIC, DOCTOR, FUTURE)
    ).rejects.toThrow(/multiple sessions/i);
  });

  it('needs no session on a single-session day', async () => {
    // The overwhelming majority of days. A move here behaves exactly as before
    // shift-wise numbering existed.
    stubDay([{ start: 9 * 60, end: 21 * 60 }]);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      FUTURE
    );

    expect(session.sessionIndex).toBe(1);
    expect(session.totalSessions).toBe(1);
  });

  it('reports the session start so a clash can name the shift', async () => {
    // The conflict message says which shift the token is taken in — "already
    // booked" alone is confusing on a day holding two token 3s.
    stubDay(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      FUTURE,
      2
    );

    expect(session.sessionStart).toBe('17:00');
    expect(session.totalSessions).toBe(2);
  });
});
