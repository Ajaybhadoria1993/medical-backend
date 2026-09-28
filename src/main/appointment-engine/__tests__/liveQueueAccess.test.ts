/**
 * The one access rule the live-queue REST endpoint and socket join share.
 * The two had drifted: the socket still judged "today" by the UTC server clock.
 */

const selectResults: unknown[][] = [];

jest.mock('../../../configurations/dbConnection', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(selectResults.shift() ?? []),
  };
  return { database: { select: () => chain } };
});

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null) },
}));

import { loadLiveQueueAppointment } from '../services/liveQueueHelper';

const OWNER = 'patient-1';
const today = () => new Date();

function appointment(over: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    patientId: OWNER,
    appointmentDate: today(),
    appointmentTime: null,
    appointmentStatus: 'Patient Arrived',
    tokenNo: 1,
    ...over,
  };
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (err) => err?.details?.code
  );

beforeEach(() => {
  selectResults.length = 0;
});

describe('loadLiveQueueAppointment', () => {
  it('lets the patient open their own appointment', async () => {
    selectResults.push([appointment()]);
    await expect(
      loadLiveQueueAppointment('appt-1', OWNER)
    ).resolves.toMatchObject({
      id: 'appt-1',
      doctorId: 'doctor-1',
    });
  });

  it('lets the family primary open a linked member’s appointment', async () => {
    selectResults.push([appointment()], [{ id: 'link-1' }]);
    expect(await codeOf(loadLiveQueueAppointment('appt-1', 'primary-1'))).toBe(
      'OK'
    );
  });

  it('denies anyone else, before revealing date or status', async () => {
    // Yesterday and finished: a stranger must still get ACCESS_DENIED.
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    selectResults.push(
      [
        appointment({
          appointmentDate: yesterday,
          appointmentStatus: 'Completed',
        }),
      ],
      []
    );
    expect(await codeOf(loadLiveQueueAppointment('appt-1', 'stranger'))).toBe(
      'ACCESS_DENIED'
    );
  });

  it("rejects an appointment that is not today's", async () => {
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    selectResults.push([appointment({ appointmentDate: yesterday })]);
    expect(await codeOf(loadLiveQueueAppointment('appt-1', OWNER))).toBe(
      'NOT_TODAY'
    );
  });

  it('rejects a finished appointment', async () => {
    selectResults.push([appointment({ appointmentStatus: 'Completed' })]);
    expect(await codeOf(loadLiveQueueAppointment('appt-1', OWNER))).toBe(
      'TERMINAL_STATUS'
    );
  });

  it('reports a missing appointment as NOT_FOUND', async () => {
    selectResults.push([]);
    expect(await codeOf(loadLiveQueueAppointment('nope', OWNER))).toBe(
      'NOT_FOUND'
    );
  });
});
