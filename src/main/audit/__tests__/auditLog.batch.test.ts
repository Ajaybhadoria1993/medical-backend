import { AuditLogService } from '../services/auditLog.service';

const values = jest.fn().mockResolvedValue(undefined);
// Staff assignments found by the batched lookup: user-2 belongs to clinic-2.
const staffRows = [{ userId: 'user-2', clinicId: 'clinic-2' }];

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    insert: () => ({ values: (...a: unknown[]) => values(...a) }),
    selectDistinctOn: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(staffRows) }),
      }),
    }),
  },
}));
jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const entry = (userId: string, clinicId: string | null) => ({
  userId,
  clinicId,
  action: 'appointment.booked',
  entityId: null,
  ip: null,
});

describe('AuditLogService batching', () => {
  beforeEach(() => values.mockClear());

  it('writes queued entries in one insert and resolves missing clinics in the same pass', async () => {
    await AuditLogService.record(entry('user-1', 'clinic-1'));
    await AuditLogService.record(entry('user-2', null));
    await AuditLogService.record(entry('user-3', null)); // no clinic: skipped, like before
    expect(values).not.toHaveBeenCalled();

    await AuditLogService.flush();

    expect(values).toHaveBeenCalledTimes(1);
    const rows = values.mock.calls[0][0] as Array<{
      userId: string;
      clinicId: string;
      createdAt: Date;
    }>;
    expect(rows.map((r) => [r.userId, r.clinicId])).toEqual([
      ['user-1', 'clinic-1'],
      ['user-2', 'clinic-2'],
    ]);
    expect(rows.every((r) => r.createdAt instanceof Date)).toBe(true);
  });

  it('keeps the process healthy when the insert fails', async () => {
    values.mockRejectedValueOnce(new Error('db down'));
    await AuditLogService.record(entry('user-1', 'clinic-1'));
    await expect(AuditLogService.flush()).resolves.toBeUndefined();
  });
});
