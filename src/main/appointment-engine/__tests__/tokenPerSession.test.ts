/**
 * Unit tests for shift-wise token numbering.
 *
 * The bug these exist for: token numbering was scoped to the day rather than
 * the shift. A doctor working 09:00-13:00 and 17:00-21:00 with 20 tokens had
 * one pool of 20 for both clinics, so once the morning filled, the evening
 * patient was told "No tokens available" — and if it had not filled, they were
 * handed whatever number came next in the morning's run. Booking after 13:00
 * was refused outright, because the end-of-day check read the weekly row's
 * single endTime and decided the doctor had finished for the day.
 *
 * A token is now identified by (date, sessionIndex, tokenNo), and numbering
 * restarts at 1 in every shift.
 */

// 10:00 IST — inside the morning session, so "today" inference has an
// unambiguous answer unless a test moves the clock.
const mockNow = { hours: 10, minutes: 0 };

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNow,
    getISTDateString: () => '2026-08-14',
  };
});

import { HttpError } from '../../../middlewear/errorHandler';
import { TokenSessionService } from '../services/tokenSession.service';
import { ScheduleShiftService } from '../services/scheduleShift.service';
import { TokenCapacityService } from '../services/tokenCapacity.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
/** The date the clock mock calls "today". */
const TODAY = '2026-08-14';
const FUTURE = '2026-08-21';

/** 09:00-13:00 morning, 17:00-21:00 evening. */
const SPLIT = [
  { start: 9 * 60, end: 13 * 60 },
  { start: 17 * 60, end: 21 * 60 },
];
const SINGLE = [{ start: 9 * 60, end: 21 * 60 }];

/**
 * Stubs the two reads session resolution makes, so these tests exercise the
 * decision — which shift, how many tokens — rather than SQL that
 * `tokenSegments.test.ts` already covers.
 */
function stub(
  segments: Array<{ start: number; end: number; slotId?: string }> | null,
  capacity = 20
) {
  jest
    .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
    .mockResolvedValue(
      segments && {
        source: 'weekly',
        slotMinutes: null,
        stepMinutes: null,
        segments,
      }
    );

  jest
    .spyOn(TokenCapacityService, 'resolveForSession')
    .mockResolvedValue({ capacity, source: 'weekly' });
}

const anyExecutor = {} as never;

beforeEach(() => {
  mockNow.hours = 10;
  mockNow.minutes = 0;
});

afterEach(() => jest.restoreAllMocks());

describe('picking the session a token belongs to', () => {
  it('honours an explicitly requested session', async () => {
    stub(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      FUTURE,
      2
    );

    expect(session.sessionIndex).toBe(2);
    expect(session.sessionStart).toBe('17:00');
    expect(session.end).toBe(21 * 60);
    expect(session.totalSessions).toBe(2);
  });

  it('rejects a session the day does not have', async () => {
    stub(SPLIT);

    await expect(
      TokenSessionService.resolve(anyExecutor, CLINIC, DOCTOR, FUTURE, 3)
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('needs no choice on a single-session day', async () => {
    stub(SINGLE);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      FUTURE
    );

    expect(session.sessionIndex).toBe(1);
    expect(session.totalSessions).toBe(1);
  });

  it('refuses to guess on a future day with two sessions', async () => {
    stub(SPLIT);

    // No clock to infer from, and putting someone in the wrong half of the day
    // is worse than asking which half they meant.
    await expect(
      TokenSessionService.resolve(anyExecutor, CLINIC, DOCTOR, FUTURE)
    ).rejects.toThrow(/multiple sessions/i);
  });

  it('infers the morning while the morning is still running', async () => {
    stub(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY
    );

    expect(session.sessionIndex).toBe(1);
  });

  it('infers the evening once the morning has ended', async () => {
    // 14:00 — the morning is over, the evening has not begun. This is the
    // reported bug: the old day-wide check compared against the weekly row's
    // single endTime and refused the booking outright.
    mockNow.hours = 14;
    stub(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY
    );

    expect(session.sessionIndex).toBe(2);
    expect(session.sessionStart).toBe('17:00');
  });

  it('still books the evening from inside the evening', async () => {
    mockNow.hours = 18;
    stub(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY
    );

    expect(session.sessionIndex).toBe(2);
  });

  it('keeps the last session open once every session has ended', async () => {
    mockNow.hours = 22;
    stub(SPLIT);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      TODAY
    );

    expect(session.sessionIndex).toBe(2);
    expect(session.sessionStart).toBe('17:00');
  });

  it('refuses a day the doctor does not work', async () => {
    stub(null);

    await expect(
      TokenSessionService.resolve(anyExecutor, CLINIC, DOCTOR, FUTURE)
    ).rejects.toThrow(/no working sessions/i);
  });

  it('carries the resolved capacity for that shift', async () => {
    stub(SPLIT, 10);

    const session = await TokenSessionService.resolve(
      anyExecutor,
      CLINIC,
      DOCTOR,
      FUTURE,
      1
    );

    expect(session.capacity).toBe(10);
  });
});
