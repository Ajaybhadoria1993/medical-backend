// Call rules that fail silently in a clinic: two answers, lost declines, a call ringing forever.
// Redis is an in-memory hash whose eval mimics the service's compare-and-set script.

const store = new Map<string, Map<string, string>>();
const hashOf = (key: string) => store.get(key) ?? new Map<string, string>();

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    hgetall: jest.fn(async (key: string) => Object.fromEntries(hashOf(key))),
    hdel: jest.fn(async (key: string, ...fields: string[]) => {
      fields.forEach((f) => hashOf(key).delete(f));
      return fields.length;
    }),
    eval: jest.fn(
      async (
        _s: string,
        _n: number,
        key: string,
        field: string,
        expected: string,
        next: string
      ) => {
        const hash = hashOf(key);
        if ((hash.get(field) ?? '') !== expected) return 0;
        hash.set(field, next);
        store.set(key, hash);
        return 1;
      }
    ),
  },
}));

const mockSockets: { data: { user: Record<string, string> } }[] = [];
jest.mock('../../../app', () => ({
  socketManager: {
    io: { in: () => ({ fetchSockets: async () => mockSockets }) },
  },
}));

const mockNotify = jest.fn();
jest.mock('../../realtime', () => ({
  realtimeBus: { notify: (...args: unknown[]) => mockNotify(...args) },
  rooms: { clinicRole: (c: string, r: string) => `clinic:${c}:role:${r}` },
  target: {
    calls: (c: string) => ({ section: `calls:${c}`, room: `clinic:${c}` }),
  },
}));

// null = assigned to every doctor, matching an unconfigured receptionist.
const mockScopes = new Map<string, string[] | null>();
jest.mock('../../permissions/services/staffScope.service', () => ({
  StaffScopeService: {
    getAccessibleDoctorIds: async ({ id }: { id: string }) =>
      mockScopes.get(id) ?? null,
  },
}));

jest.mock('../../../configurations/dbConnection', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => [{ name: 'Priya', profileImage: null }],
  };
  return { database: chain };
});

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { CallsService } from '../services/calls.service';

const CLINIC = 'c1';
const DOCTOR = { id: 'doc' };
const R1 = { id: 'r1' };
const R2 = { id: 'r2' };

const online = (...ids: string[]) => {
  mockSockets.length = 0;
  ids.forEach((id) =>
    mockSockets.push({
      data: { user: { id, name: id, userType: 'Receptionist' } },
    })
  );
};

beforeEach(() => {
  store.clear();
  mockScopes.clear();
  mockNotify.mockClear();
  jest.useRealTimers();
  online('r1', 'r2');
});

describe('CallsService', () => {
  it('rings every online assigned receptionist and signals the clinic', async () => {
    const call = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
    });

    expect(call.status).toBe('ringing');
    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(1);
    expect(
      (await CallsService.getActive(R2, CLINIC, false)).incoming
    ).toHaveLength(1);
    expect(mockNotify).toHaveBeenCalledWith(
      { section: 'calls:c1', room: 'clinic:c1' },
      'call_placed'
    );
  });

  it('skips receptionists not assigned to this doctor', async () => {
    mockScopes.set('r2', ['another-doctor']);
    await CallsService.placeCall(DOCTOR, CLINIC, { type: 'RECEPTION' });

    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(1);
    expect(
      (await CallsService.getActive(R2, CLINIC, false)).incoming
    ).toHaveLength(0);
    expect(
      (await CallsService.getActive(DOCTOR, CLINIC, true)).receptionists
    ).toEqual([{ id: 'r1', name: 'r1' }]);
  });

  it('refuses when no receptionist is online', async () => {
    online();
    await expect(
      CallsService.placeCall(DOCTOR, CLINIC, { type: 'RECEPTION' })
    ).rejects.toMatchObject({
      status: 409,
      message: 'No receptionist is online right now.',
    });
  });

  it('rings only the picked receptionist', async () => {
    await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'NEXT_PATIENT',
      receptionistId: 'r2',
    });

    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(0);
    expect(
      (await CallsService.getActive(R2, CLINIC, false)).incoming
    ).toHaveLength(1);
  });

  it('refuses a second call while one is ringing', async () => {
    await CallsService.placeCall(DOCTOR, CLINIC, { type: 'RECEPTION' });
    await expect(
      CallsService.placeCall(DOCTOR, CLINIC, { type: 'RECEPTION' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('lets only the first answer win', async () => {
    const { id } = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
    });

    const results = await Promise.allSettled([
      CallsService.answer(R1, CLINIC, id),
      CallsService.answer(R2, CLINIC, id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { status: 409, message: 'Priya already answered this call.' },
    });
    expect(
      (await CallsService.getActive(DOCTOR, CLINIC, false)).myCall?.status
    ).toBe('answered');
  });

  it('keeps ringing others after one decline, and is busy once all decline', async () => {
    const { id } = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
    });

    expect((await CallsService.decline(R1, CLINIC, id)).status).toBe('ringing');
    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(0);
    expect(
      (await CallsService.getActive(R2, CLINIC, false)).incoming
    ).toHaveLength(1);

    expect((await CallsService.decline(R2, CLINIC, id)).status).toBe('busy');
  });

  it('reads as missed after 30 seconds and allows a new call', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-16T10:00:00Z') });
    const { id } = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
    });

    jest.setSystemTime(new Date('2026-09-16T10:00:31Z'));
    expect(
      (await CallsService.getActive(DOCTOR, CLINIC, false)).myCall?.status
    ).toBe('missed');
    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(0);
    await expect(CallsService.answer(R1, CLINIC, id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      CallsService.placeCall(DOCTOR, CLINIC, { type: 'RECEPTION' })
    ).resolves.toMatchObject({ status: 'ringing' });
  });

  it('ignores receptionists the call was not sent to', async () => {
    const { id } = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
      receptionistId: 'r1',
    });

    await expect(CallsService.answer(R2, CLINIC, id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lets only the calling doctor cancel', async () => {
    const { id } = await CallsService.placeCall(DOCTOR, CLINIC, {
      type: 'RECEPTION',
    });

    await expect(
      CallsService.cancel({ id: 'other' }, CLINIC, id)
    ).rejects.toMatchObject({
      status: 404,
    });
    expect((await CallsService.cancel(DOCTOR, CLINIC, id)).status).toBe(
      'cancelled'
    );
    expect(
      (await CallsService.getActive(R1, CLINIC, false)).incoming
    ).toHaveLength(0);
  });
});
