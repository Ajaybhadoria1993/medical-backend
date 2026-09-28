/**
 * Guards the room-vacating fix: entering the room was written in three places
 * and leaving it in none, so a completed appointment stayed the queue's
 * `currentAppointmentId` with its `startedAt` intact — which is what left a
 * finished patient in LIVE NOW with the consultation timer still counting.
 */

const store = new Map<string, string>();

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    hget: jest.fn(async () => null),
  },
}));

import redisClient from '../../../configurations/redisConfig';
import {
  endConsultationIfOccupant,
  getConsultationEndedAt,
  getConsultationStartedAt,
  getCurrentAppointmentId,
  setConsultationStartedAt,
  setCurrentAppointment,
} from '../services/queueHoldStore.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-09-09';
const APPT = 'appt-in-room';

/** Puts APPT in the room with a running timer, as `putInRoom` would. */
const seedOccupiedRoom = async () => {
  await setCurrentAppointment(CLINIC, DOCTOR, DATE, APPT);
  await setConsultationStartedAt(
    CLINIC,
    DOCTOR,
    DATE,
    new Date('2026-09-09T10:00:00.000Z').toISOString()
  );
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('endConsultationIfOccupant', () => {
  it('clears the room pointer and the timer for the occupant', async () => {
    await seedOccupiedRoom();

    const vacated = await endConsultationIfOccupant(CLINIC, DOCTOR, DATE, APPT);

    expect(vacated).toBe(true);
    // Both must go: the pointer drives "who is live", the start drives the timer.
    expect(await getCurrentAppointmentId(CLINIC, DOCTOR, DATE)).toBeNull();
    expect(await getConsultationStartedAt(CLINIC, DOCTOR, DATE)).toBeNull();
  });

  it('records an end instant, so the projection re-anchors to it', async () => {
    await seedOccupiedRoom();

    await endConsultationIfOccupant(CLINIC, DOCTOR, DATE, APPT);

    expect(await getConsultationEndedAt(CLINIC, DOCTOR, DATE)).not.toBeNull();
  });

  it('leaves the room alone when a different appointment completes', async () => {
    await seedOccupiedRoom();

    const vacated = await endConsultationIfOccupant(
      CLINIC,
      DOCTOR,
      DATE,
      'some-earlier-appt'
    );

    // A late edit to an earlier row must not evict the current patient.
    expect(vacated).toBe(false);
    expect(await getCurrentAppointmentId(CLINIC, DOCTOR, DATE)).toBe(APPT);
    expect(await getConsultationStartedAt(CLINIC, DOCTOR, DATE)).not.toBeNull();
  });

  it('is idempotent, so the engine hook repeating it is harmless', async () => {
    await seedOccupiedRoom();

    expect(await endConsultationIfOccupant(CLINIC, DOCTOR, DATE, APPT)).toBe(
      true
    );
    expect(await endConsultationIfOccupant(CLINIC, DOCTOR, DATE, APPT)).toBe(
      false
    );
    expect(await getCurrentAppointmentId(CLINIC, DOCTOR, DATE)).toBeNull();
  });

  it('never throws when Redis is down — an empty room is recoverable', async () => {
    (redisClient.get as jest.Mock).mockRejectedValueOnce(new Error('down'));

    await expect(
      endConsultationIfOccupant(CLINIC, DOCTOR, DATE, APPT)
    ).resolves.toBe(false);
  });
});
