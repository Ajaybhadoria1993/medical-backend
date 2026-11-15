import { FeeConfigVersionService as Fees } from '../services/feeConfigVersion.service';

let rows: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const inserts: Record<string, unknown>[] = [];

jest.mock('../../../configurations/dbConnection', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['from', 'where', 'orderBy', 'leftJoin', 'limit'])
      c[k] = () => c;
    c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(ok, bad);
    return c;
  };
  const db = {
    select: (shape?: Record<string, unknown>) =>
      chain(() => (shape && 'v' in shape ? [{ v: 3 }] : rows)),
    selectDistinct: () => chain(() => rows),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => updates.push(v),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => (inserts.push(v), [v]),
      }),
    }),
    execute: async () => [],
  };
  return {
    database: {
      ...db,
      transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    },
  };
});

const row = (o: Record<string, unknown>) => ({
  feeType: 'CONVENIENCE_FEE',
  clinicId: null,
  calculationMethod: 'PERCENTAGE',
  rateOrAmount: '2.0000',
  enabled: true,
  taxRate: '18.00',
  effectiveFrom: new Date('2026-01-01'),
  version: 1,
  ...o,
});

beforeEach(() => {
  rows = [];
  updates.length = 0;
  inserts.length = 0;
});

describe('fee limits', () => {
  it('refuses values over the limit or a fixed gateway fee', () => {
    expect(() => Fees.check('CONVENIENCE_FEE', 'PERCENTAGE', 20)).toThrow(
      'Maximum is 10%'
    );
    expect(() => Fees.check('CLINIC_COMMISSION', 'FIXED', 600)).toThrow(
      'Maximum is ₹500'
    );
    expect(() => Fees.check('GATEWAY_FEE', 'FIXED', 10)).toThrow(
      'only be a percentage'
    );
    expect(() =>
      Fees.check('CLINIC_COMMISSION', 'PERCENTAGE', 25)
    ).not.toThrow();
  });
});

describe('which fee applies', () => {
  it("a clinic's own fee beats the default; a future one is shown as scheduled", async () => {
    rows = [
      row({ clinicId: 'c1', rateOrAmount: '1.0000' }),
      row({ rateOrAmount: '2.0000' }),
      row({
        clinicId: 'c1',
        rateOrAmount: '3.0000',
        effectiveFrom: new Date('2099-01-01'),
      }),
    ];
    const conv = (await Fees.current('c1')).find(
      (f) => f.feeType === 'CONVENIENCE_FEE'
    )!;
    expect(conv).toMatchObject({
      source: 'clinic',
      amount: 1,
      scheduled: { amount: 3 },
    });
  });

  it('a clinic without its own fee uses the default', async () => {
    rows = [row({ rateOrAmount: '2.0000' })];
    expect((await Fees.current('c2'))[0]).toMatchObject({
      source: 'default',
      amount: 2,
    });
  });
});

describe('save', () => {
  it('closes the version in force at the start and replaces a scheduled one', async () => {
    const from = new Date('2099-06-01');
    rows = [
      row({ id: 'live', effectiveFrom: new Date('2026-01-01') }),
      row({ id: 'later', effectiveFrom: new Date('2099-07-01') }),
    ];
    await Fees.save({
      clinicId: null,
      feeType: 'CONVENIENCE_FEE',
      method: 'PERCENTAGE',
      amount: 3,
      enabled: true,
      effectiveFrom: from,
      actorId: 'sa1',
    });
    expect(updates).toEqual([{ effectiveTo: from }, { isActive: false }]);
    expect(inserts[0]).toMatchObject({
      version: 4,
      rateOrAmount: '3.0000',
      effectiveFrom: from,
      createdBy: 'sa1',
      scope: 'GLOBAL',
    });
  });

  it('a value over the limit saves nothing', async () => {
    await expect(
      Fees.save({
        clinicId: 'c1',
        feeType: 'GATEWAY_FEE',
        method: 'PERCENTAGE',
        amount: 9,
        enabled: true,
        actorId: 'sa1',
      })
    ).rejects.toMatchObject({ status: 422 });
    expect(inserts).toHaveLength(0);
  });
});

describe('reset and preview', () => {
  it("reset ends the clinic's current fee and drops its scheduled one", async () => {
    rows = [
      { id: 'live', effectiveFrom: new Date('2026-01-01') },
      { id: 'later', effectiveFrom: new Date('2099-01-01') },
    ];
    expect(await Fees.resetClinic('c1')).toBe(2);
    expect(updates[0]).toHaveProperty('effectiveTo');
    expect(updates[1]).toEqual({ isActive: false });
  });

  it('preview uses the booking engine: ₹500 with 2% + 10% + 2% (all + GST)', () => {
    const r = Fees.preview(500, [
      {
        feeType: 'CONVENIENCE_FEE',
        method: 'PERCENTAGE',
        amount: 2,
        enabled: true,
      },
      {
        feeType: 'CLINIC_COMMISSION',
        method: 'PERCENTAGE',
        amount: 10,
        enabled: true,
      },
      {
        feeType: 'GATEWAY_FEE',
        method: 'PERCENTAGE',
        amount: 2,
        enabled: true,
      },
    ]);
    expect(r.clinicAmount).toBe(500);
    expect(r.patientTotal).toBe(584.28);
  });
});
