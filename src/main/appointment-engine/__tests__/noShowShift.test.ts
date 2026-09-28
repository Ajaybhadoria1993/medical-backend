/**
 * End-to-end behaviour of a no-show shift, against a mocked database.
 *
 * The row filtering itself lives in SQL and cannot be exercised here — that is
 * asserted as a predicate in noShowSession.test.ts. What this covers is what
 * happens to the rows once they arrive: which branch a day takes, the shift
 * arithmetic, and the guard that stops a token placeholder being rewritten.
 */

import { database } from '../../../configurations/dbConnection';
import { NoShowShiftService } from '../services/noShowShift.service';
import { DelayTrackerService } from '../services/delayTracker.service';

type Row = Record<string, unknown>;

/** A drizzle builder that resolves to `value` however it is chained. */
const chain = (value: unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of [
    'from',
    'where',
    'limit',
    'orderBy',
    'innerJoin',
    'leftJoin',
  ]) {
    c[m] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(value);
  return c;
};

/** Captures every `set()` the transaction applies, keyed in call order. */
const updates: Array<Record<string, unknown>> = [];

const mockDb = (selects: unknown[][]) => {
  const select = database.select as jest.Mock;
  select.mockReset();
  selects.forEach((rows) => select.mockReturnValueOnce(chain(rows)));
  select.mockReturnValue(chain([]));

  (database.transaction as jest.Mock).mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        update: () => ({
          set: (values: Record<string, unknown>) => {
            updates.push(values);
            return { where: jest.fn().mockResolvedValue(undefined) };
          },
        }),
      })
  );
};

beforeEach(() => {
  updates.length = 0;
  jest.clearAllMocks();
  jest
    .spyOn(DelayTrackerService.prototype, 'resolveSlotMinutes')
    .mockResolvedValue(30);
  jest
    .spyOn(DelayTrackerService.prototype, 'recalculate')
    .mockResolvedValue(undefined as never);
});

const noShowAppt = (over: Row = {}): Row => ({
  id: 'ns-1',
  clinicId: 'clinic-1',
  doctorId: 'doctor-1',
  appointmentDate: new Date('2026-10-15'),
  appointmentTime: '10:00',
  tokenNo: null,
  sessionIndex: null,
  appointmentDurationMinutes: '30',
  appointmentStatus: 'NoShow',
  patientId: 'patient-1',
  ...over,
});

const shiftable = (over: Row = {}): Row => ({
  id: 'a-1',
  appointmentTime: '11:00',
  tokenNo: null,
  appointmentStatus: 'Upcoming',
  patientId: 'patient-2',
  appointmentDurationMinutes: '30',
  ...over,
});

describe('NoShowShiftService.shiftForward', () => {
  it('pulls a later time-based appointment earlier by the no-show duration', async () => {
    // No breaks, so 11:00 moves back a clean 30 minutes.
    mockDb([[noShowAppt()], [shiftable()], [], []]);

    const result = await new NoShowShiftService().shiftForward('ns-1');

    expect(updates).toEqual([{ appointmentTime: '10:30' }]);
    expect(result.shiftedAppointments).toEqual([
      expect.objectContaining({
        appointmentId: 'a-1',
        oldTime: '11:00',
        newTime: '10:30',
      }),
    ]);
  });

  it('never rewrites a token placeholder on a mixed day', async () => {
    // Both kinds of row, so the token-queue branch cannot short-circuit and
    // the loop itself has to skip the placeholder. Unguarded, 23:59 became
    // 23:29 and the booking stopped reading as a token anywhere.
    mockDb([
      [noShowAppt()],
      [
        shiftable(),
        shiftable({ id: 'a-2', appointmentTime: '23:59', tokenNo: 4 }),
      ],
      [],
      [],
    ]);

    const result = await new NoShowShiftService().shiftForward('ns-1');

    expect(updates).toEqual([{ appointmentTime: '10:30' }]);
    expect(result.shiftedAppointments.map((a) => a.appointmentId)).toEqual([
      'a-1',
    ]);
  });

  it('recalculates the wait instead of shifting on a token day', async () => {
    const recalculate = jest.spyOn(
      DelayTrackerService.prototype,
      'recalculate'
    );
    mockDb([
      [noShowAppt({ appointmentTime: '23:59', tokenNo: 3, sessionIndex: 1 })],
      [shiftable({ appointmentTime: '23:59', tokenNo: 4 })],
      [],
      [],
    ]);

    const result = await new NoShowShiftService().shiftForward('ns-1');

    expect(recalculate).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      '2026-10-15'
    );
    expect(updates).toEqual([]);
    expect(result.shiftedAppointments).toEqual([]);
  });

  it('places a shifted time at the end of a break it would land in', async () => {
    // 12:00 back 30m is 11:30, inside 11:00-12:00, so it lands at 12:00.
    mockDb([
      [noShowAppt()],
      [shiftable({ appointmentTime: '12:00' })],
      [{ id: 'avail-1' }],
      [{ startTime: '11:00', endTime: '12:00' }],
    ]);

    await new NoShowShiftService().shiftForward('ns-1');

    expect(updates).toEqual([{ appointmentTime: '12:00' }]);
  });

  it('skips a day whose later appointments are all finished', async () => {
    mockDb([
      [noShowAppt()],
      [shiftable({ appointmentStatus: 'Completed' })],
      [],
      [],
    ]);

    const result = await new NoShowShiftService().shiftForward('ns-1');

    expect(updates).toEqual([]);
    expect(result.shiftedAppointments).toEqual([]);
  });

  it('does nothing when the no-show has no doctor', async () => {
    mockDb([[noShowAppt({ doctorId: null })]]);

    const result = await new NoShowShiftService().shiftForward('ns-1');

    expect(updates).toEqual([]);
    expect(result.shiftedAppointments).toEqual([]);
  });
});
