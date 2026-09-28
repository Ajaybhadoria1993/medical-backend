/** Whose arrival a shift reports: each token sitting needs its own, while a
 * time day's lunch break carries the morning arrival across. */

const selectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: () => selectMock(),
  },
}));

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

// Pulled in at module load for the post-arrival refresh; never reached here.
jest.mock('../services/orchestrator.service', () => ({
  AppointmentEngineOrchestrator: jest.fn(),
}));

import { DoctorArrivalService } from '../services/doctorArrival.service';
import { SlotConfigService } from '../services/slotConfig.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-09-16';

const arrivalRow = (sessionStart: string | null, arrivedAt: string) => ({
  doctorId: DOCTOR,
  arrivedAt: new Date(arrivedAt),
  sessionStart,
  source: 'reception',
  createdBy: 'user-1',
});

/**
 * Drizzle's chain ends at `.limit()`, so each queued result answers one whole
 * query: first the current shift's own row, then the day-wide fallback.
 */
function queueQueryResults(results: unknown[][]) {
  const pending = [...results];
  selectMock.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    const step = () => chain;
    chain.from = step;
    chain.where = step;
    chain.orderBy = step;
    chain.limit = () => Promise.resolve(pending.shift() ?? []);
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Pinned rather than derived from the clock: the shift under test is the
  // 14:00 one whatever time the suite happens to run at.
  jest
    .spyOn(DoctorArrivalService as never, 'resolveSessionStart')
    .mockResolvedValue('14:00' as never);
});

afterEach(() => jest.restoreAllMocks());

describe('getArrival — which shift an arrival belongs to', () => {
  it('does not lend the morning arrival to an evening token sitting', async () => {
    const isTokenDay = jest
      .spyOn(SlotConfigService, 'isWeeklyTokenDay')
      .mockResolvedValue(true);
    // No row for 14:00; the morning's 09:05 is all the day holds.
    queueQueryResults([[], [arrivalRow('09:00', '2026-09-16T03:35:00.000Z')]]);

    const arrival = await DoctorArrivalService.getArrival(CLINIC, DOCTOR, DATE);

    expect(isTokenDay).toHaveBeenCalledWith(CLINIC, DOCTOR, DATE);
    expect(arrival).toBeNull();
  });

  it('carries a time-based day arrival across its lunch break', async () => {
    jest.spyOn(SlotConfigService, 'isWeeklyTokenDay').mockResolvedValue(false);
    queueQueryResults([[], [arrivalRow('09:00', '2026-09-16T03:35:00.000Z')]]);

    const arrival = await DoctorArrivalService.getArrival(CLINIC, DOCTOR, DATE);

    // Same doctor, same building — the break was lunch, not a second clinic.
    expect(arrival?.sessionStart).toBe('09:00');
  });

  it("returns the shift's own arrival without asking what kind of day it is", async () => {
    const isTokenDay = jest.spyOn(SlotConfigService, 'isWeeklyTokenDay');
    queueQueryResults([[arrivalRow('14:00', '2026-09-16T12:09:00.000Z')]]);

    const arrival = await DoctorArrivalService.getArrival(CLINIC, DOCTOR, DATE);

    expect(arrival?.sessionStart).toBe('14:00');
    // The check costs a query, so it must stay off the path every read takes.
    expect(isTokenDay).not.toHaveBeenCalled();
  });
});
