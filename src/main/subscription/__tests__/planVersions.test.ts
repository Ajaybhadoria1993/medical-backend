import { database } from '../../../configurations/dbConnection';
import { PlansService } from '../services/core/plans.service';

jest.mock('../notify/subscriptionNotify', () => ({
  subscriptionNotify: jest.fn(),
}));
jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn(), transaction: jest.fn() },
}));

// A query builder that resolves to `rows` however it is chained.
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'for']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const tomorrow = () => new Date(Date.now() + 86_400_000);
const v1 = {
  id: 'v1',
  planId: 'clinic',
  versionNo: 1,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
};

describe('PlansService versions', () => {
  beforeEach(() => jest.resetAllMocks());

  it('refuses a start date in the past, before touching the database', async () => {
    await expect(
      PlansService.createVersion(
        'clinic',
        {
          monthlyPrice: 599,
          yearlyPrice: null,
          effectiveFrom: new Date('2020-01-01'),
        },
        null
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('refuses a paid plan with no price', async () => {
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(rowsOf([{ id: 'clinic', kind: 'paid' }])),
    };
    (database.transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    await expect(
      PlansService.createVersion(
        'clinic',
        { monthlyPrice: null, yearlyPrice: null, effectiveFrom: tomorrow() },
        null
      )
    ).rejects.toMatchObject({
      status: 400,
      message: 'A paid plan needs a monthly or a yearly price.',
    });
  });

  it('copies the latest version limits and overrides the ones sent', async () => {
    const inserted: Record<string, unknown[]> = {};
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(rowsOf([{ id: 'clinic', kind: 'paid' }]))
        .mockReturnValueOnce(rowsOf([v1]))
        .mockReturnValueOnce(
          rowsOf([
            {
              id: 'f1',
              planId: 'clinic',
              planVersionId: 'v1',
              featureKey: 'doctor_accounts',
              limitValue: 2,
              isUnlimited: false,
              enabled: true,
            },
            {
              id: 'f2',
              planId: 'clinic',
              planVersionId: 'v1',
              featureKey: 'staff_accounts',
              limitValue: 3,
              isUnlimited: false,
              enabled: true,
            },
          ])
        )
        .mockReturnValueOnce(rowsOf([])),
      insert: (table: unknown) => ({
        values: (v: unknown) => {
          const key = inserted.version ? 'features' : 'version';
          inserted[key] = Array.isArray(v) ? v : [v];
          return {
            returning: () => rowsOf([{ id: 'v2', versionNo: 2 }]),
            then: (ok: (x: unknown) => unknown) => Promise.resolve().then(ok),
          };
        },
        table,
      }),
    };
    (database.transaction as jest.Mock).mockImplementation((fn) => fn(tx));

    const version = await PlansService.createVersion(
      'clinic',
      {
        monthlyPrice: 599,
        yearlyPrice: null,
        effectiveFrom: tomorrow(),
        limits: [
          {
            featureKey: 'doctor_accounts',
            limitValue: 4,
            isUnlimited: false,
            enabled: true,
          },
        ],
      },
      'admin-1'
    );

    expect(version).toMatchObject({ id: 'v2', versionNo: 2 });
    expect(inserted.version[0]).toMatchObject({
      versionNo: 2,
      monthlyPrice: '599',
      yearlyPrice: null,
    });
    expect(inserted.features).toEqual([
      expect.objectContaining({
        planVersionId: 'v2',
        featureKey: 'doctor_accounts',
        limitValue: 4,
      }),
      expect.objectContaining({
        planVersionId: 'v2',
        featureKey: 'staff_accounts',
        limitValue: 3,
      }),
    ]);
  });

  it('will not edit a version clinics are on', async () => {
    (database.select as jest.Mock)
      .mockReturnValueOnce(rowsOf([v1]))
      .mockReturnValueOnce(rowsOf([{ id: 'sub-1' }]));
    await expect(PlansService.editableVersion('clinic')).rejects.toMatchObject({
      status: 409,
    });
  });

  // A scheduled version is the newest one, has not started and has no clinics.
  const scheduled = {
    ...v1,
    id: 'v2',
    versionNo: 2,
    effectiveFrom: tomorrow(),
  };
  const txWith = (...results: unknown[][]) => {
    const tx = {
      select: jest.fn(),
      delete: jest.fn(() => ({ where: jest.fn() })),
    };
    results.forEach((r) => tx.select.mockReturnValueOnce(rowsOf(r)));
    (database.transaction as jest.Mock).mockImplementation((fn) => fn(tx));
    return tx;
  };

  it('will not cancel a version that has already started', async () => {
    txWith(
      [{ ...scheduled, effectiveFrom: new Date('2026-01-01T00:00:00Z') }],
      []
    );
    await expect(
      PlansService.deleteScheduledVersion('clinic', 'v2')
    ).rejects.toMatchObject({ status: 409 });
  });

  it('will not cancel a scheduled version clinics are already on', async () => {
    txWith([scheduled], [], [{ id: 'sub-1' }]);
    await expect(
      PlansService.deleteScheduledVersion('clinic', 'v2')
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cancels a scheduled version with no clinics', async () => {
    const tx = txWith([scheduled], [], []);
    await expect(
      PlansService.deleteScheduledVersion('clinic', 'v2')
    ).resolves.toMatchObject({ id: 'v2' });
    expect(tx.delete).toHaveBeenCalledTimes(3);
  });

  it('will not end a plan in the past', async () => {
    await expect(
      PlansService.endPlan('clinic', {
        endsAt: new Date('2020-01-01'),
        replacementPlanId: null,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('will not move clinics to the same plan', async () => {
    await expect(
      PlansService.endPlan('clinic', {
        endsAt: tomorrow(),
        replacementPlanId: 'clinic',
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('will not move clinics to a plan that is not on sale', async () => {
    (database.select as jest.Mock).mockReturnValueOnce(
      rowsOf([{ name: 'Old', isActive: false, endsAt: null }])
    );
    await expect(
      PlansService.endPlan('clinic', {
        endsAt: tomorrow(),
        replacementPlanId: 'old',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Clinics can only move to a plan that is on sale.',
    });
  });
});
