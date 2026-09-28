/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for Drizzle's fluent query chains */
// Unit tests for the Add/Edit Lab Test logic in LabService: syncing a test's
// result fields, loading them for Edit, and adding a lab-owned department.

const transactionMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

jest.mock('../../../utils/logger');
jest.mock('../../../configurations/s3', () => ({ deleteFromS3: jest.fn() }));
jest.mock('../../../utils/pdf.utils', () => ({
  generateAndUploadPdf: jest.fn(),
}));
jest.mock('../../realtime', () => ({
  signalLabChange: jest.fn(),
  realtimeBus: { emit: jest.fn() },
  target: jest.fn(),
}));
jest.mock('../../notifications/services/labNotification.service', () => ({
  LabNotificationService: {},
}));

import {
  LabDepartmentsMasterModel,
  LabDepartmentsModel,
} from '../models/lab.model';
import { LabService } from '../services/lab.service';

// The sync helpers are private; tests reach them the way a caller inside the class would.
const lab = LabService as any;

type Call = { method: string; args: any[] };

/** Chainable query stub: records every call and resolves to `rows` when awaited. */
const queryReturning = (rows: unknown) => {
  const calls: Call[] = [];
  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve(rows);
        }
        if (prop === 'calls') return calls;
        return (...args: any[]) => {
          calls.push({ method: String(prop), args });
          return chain;
        };
      },
    }
  );
  return chain;
};

const argsOf = (chain: any, method: string) =>
  (chain.calls as Call[]).filter((c) => c.method === method).map((c) => c.args);

/** True when a Drizzle condition tree binds `needle` as a value. */
const bindsValue = (node: any, needle: unknown, depth = 0): boolean => {
  // and(or(eq(...))) nests about 11 levels deep before reaching the bound value.
  if (depth > 20 || node == null) return false;
  if (node === needle) return true;
  if (Array.isArray(node)) {
    return node.some((item) => bindsValue(item, needle, depth + 1));
  }
  if (typeof node !== 'object') return false;
  return ['value', 'queryChunks', 'left', 'right', 'conditions'].some((key) =>
    bindsValue(node[key], needle, depth + 1)
  );
};

/** Fake transaction: each select/insert resolves to the next queued rows; every call is kept. */
const fakeTx = ({
  selects = [],
  inserts = [],
}: { selects?: unknown[][]; inserts?: unknown[][] } = {}) => {
  const tx = {
    selects: [] as any[],
    updates: [] as Array<{ model: unknown; q: any }>,
    inserts: [] as Array<{ model: unknown; q: any }>,
    select: jest.fn(() => {
      const q = queryReturning(selects.shift() ?? []);
      tx.selects.push(q);
      return q;
    }),
    update: jest.fn((model: unknown) => {
      const q = queryReturning([]);
      tx.updates.push({ model, q });
      return q;
    }),
    insert: jest.fn((model: unknown) => {
      const q = queryReturning(inserts.shift() ?? []);
      tx.inserts.push({ model, q });
      return q;
    }),
  };
  return tx;
};

const TARGET = { templateId: 'tpl-1', labId: 'lab-1', userId: 'user-1' };
const CONTEXT = {
  clinicId: 'clinic-1',
  userId: 'user-1',
  userRole: 'Lab_Assistant',
};

const field = (overrides: Record<string, unknown> = {}) => ({
  sectionName: '-',
  parameterName: 'Haemoglobin',
  unit: 'g/dL',
  referenceRange: '13 - 17',
  inputType: 'number',
  sortOrder: 10,
  isRequired: true,
  ...overrides,
});

afterEach(() => {
  jest.restoreAllMocks();
  transactionMock.mockReset();
});

describe('LabService.syncCustomFields', () => {
  it('updates listed fields, adds new ones and deactivates the ones removed', async () => {
    const tx = fakeTx({ selects: [[{ id: 'f-keep' }, { id: 'f-drop' }]] });

    await lab.syncCustomFields(tx, TARGET, [
      field({ id: 'f-keep', parameterName: 'Hb' }),
      field({ parameterName: 'RBC' }),
    ]);

    const [kept, dropped] = tx.updates;
    expect(argsOf(kept.q, 'set')[0][0]).toMatchObject({
      parameterName: 'Hb',
      updatedBy: 'user-1',
    });
    expect(bindsValue(argsOf(kept.q, 'where')[0][0], 'f-keep')).toBe(true);

    expect(argsOf(dropped.q, 'set')[0][0]).toMatchObject({ isActive: false });
    const dropWhere = argsOf(dropped.q, 'where')[0][0];
    expect(bindsValue(dropWhere, 'f-drop')).toBe(true);
    expect(bindsValue(dropWhere, 'f-keep')).toBe(false);

    expect(tx.inserts).toHaveLength(1);
    expect(argsOf(tx.inserts[0].q, 'values')[0][0]).toEqual([
      expect.objectContaining({
        parameterName: 'RBC',
        templateId: 'tpl-1',
        labId: 'lab-1',
        isCustom: true,
        sourceType: 'CUSTOM',
        createdBy: 'user-1',
      }),
    ]);
  });

  it("never updates a field id that isn't this lab's own on this template", async () => {
    const tx = fakeTx({ selects: [[{ id: 'f-mine' }]] });

    await lab.syncCustomFields(tx, TARGET, [
      field({ id: 'f-other-lab', parameterName: 'Copied field' }),
    ]);

    // The only update is the deactivation of the field no longer listed.
    expect(tx.updates).toHaveLength(1);
    expect(argsOf(tx.updates[0].q, 'set')[0][0]).toMatchObject({
      isActive: false,
    });

    const [row] = argsOf(tx.inserts[0].q, 'values')[0][0];
    expect(row).not.toHaveProperty('id');
    expect(row).toMatchObject({
      parameterName: 'Copied field',
      labId: 'lab-1',
    });
  });

  it('looks up existing fields only on this template for this lab', async () => {
    const tx = fakeTx({ selects: [[]] });

    await lab.syncCustomFields(tx, TARGET, []);

    const where = argsOf(tx.selects[0], 'where')[0][0];
    expect(bindsValue(where, 'tpl-1')).toBe(true);
    expect(bindsValue(where, 'lab-1')).toBe(true);
    expect(tx.updates).toHaveLength(0);
    expect(tx.inserts).toHaveLength(0);
  });
});

describe('LabService.getLabCatalogTestCustomFields', () => {
  it('returns no fields and creates nothing when the test has no template yet', async () => {
    const tx = fakeTx();
    transactionMock.mockImplementation((run: (t: unknown) => unknown) =>
      run(tx)
    );
    jest.spyOn(lab, 'getScopedLabTest').mockResolvedValue({
      id: 'test-1',
      name: 'Dakota Ewing',
      testCode: null,
      category: null,
      labId: 'lab-1',
    });
    const byCode = jest
      .spyOn(lab, 'getActiveReportTemplateByCode')
      .mockResolvedValue(null);

    await expect(
      LabService.getLabCatalogTestCustomFields('test-1', CONTEXT)
    ).resolves.toEqual([]);

    expect(byCode).toHaveBeenCalledWith(
      tx,
      expect.stringMatching(/^CUSTOM_/),
      'lab-1'
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("finds the template by the test's code and returns this lab's active fields", async () => {
    const rows = [{ id: 'f-1', parameterName: 'Haemoglobin' }];
    const tx = fakeTx({ selects: [rows] });
    transactionMock.mockImplementation((run: (t: unknown) => unknown) =>
      run(tx)
    );
    jest.spyOn(lab, 'getScopedLabTest').mockResolvedValue({
      id: 'test-1',
      name: 'Complete blood count',
      testCode: 'CBC',
      category: 'Hematology',
      labId: 'lab-1',
    });
    const byCode = jest
      .spyOn(lab, 'getActiveReportTemplateByCode')
      .mockResolvedValue({ id: 'tpl-cbc' });

    await expect(
      LabService.getLabCatalogTestCustomFields('test-1', CONTEXT)
    ).resolves.toEqual(rows);

    expect(byCode).toHaveBeenCalledWith(tx, 'CBC', 'lab-1');
    const where = argsOf(tx.selects[0], 'where')[0][0];
    expect(bindsValue(where, 'tpl-cbc')).toBe(true);
    expect(bindsValue(where, 'lab-1')).toBe(true);
  });
});

describe('LabService.createDepartment', () => {
  const arrangeLab = () =>
    jest
      .spyOn(lab, 'getLabAccessForUser')
      .mockResolvedValue({ labId: 'lab-1', clinicId: 'clinic-1' });

  it('creates a lab-owned department with a unique code and links it to the lab', async () => {
    const created = { id: 'dept-new', name: 'Urology', labId: 'lab-1' };
    const tx = fakeTx({ selects: [[]], inserts: [[created], []] });
    transactionMock.mockImplementation((run: (t: unknown) => unknown) =>
      run(tx)
    );
    arrangeLab();

    const result = await LabService.createDepartment(
      'user-1',
      'clinic-1',
      'Urology',
      {
        labId: 'lab-1',
        userRole: 'Lab_Assistant',
      }
    );

    expect(result).toEqual({ ...created, tests: [] });

    const [master, link] = tx.inserts;
    expect(master.model).toBe(LabDepartmentsMasterModel);
    const values = argsOf(master.q, 'values')[0][0];
    expect(values).toMatchObject({ labId: 'lab-1', name: 'Urology' });
    expect(values.code).toMatch(/^UROLOGY_[0-9A-F]{6}$/);

    expect(link.model).toBe(LabDepartmentsModel);
    expect(argsOf(link.q, 'values')[0][0]).toEqual({
      labId: 'lab-1',
      departmentId: 'dept-new',
    });
    expect(argsOf(link.q, 'onConflictDoNothing')).toHaveLength(1);
  });

  it('reuses a same-name department instead of creating a duplicate', async () => {
    const existing = { id: 'dept-1', name: 'Urology', labId: 'lab-1' };
    const tx = fakeTx({ selects: [[existing]], inserts: [[]] });
    transactionMock.mockImplementation((run: (t: unknown) => unknown) =>
      run(tx)
    );
    arrangeLab();

    const result = await LabService.createDepartment(
      'user-1',
      'clinic-1',
      'urology'
    );

    expect(result).toEqual({ ...existing, tests: [] });
    expect(tx.inserts).toHaveLength(1);
    expect(tx.inserts[0].model).toBe(LabDepartmentsModel);
  });

  it("checks names only against global departments and this lab's own", async () => {
    const tx = fakeTx({ selects: [[{ id: 'dept-1' }]], inserts: [[]] });
    transactionMock.mockImplementation((run: (t: unknown) => unknown) =>
      run(tx)
    );
    arrangeLab();

    await LabService.createDepartment('user-1', 'clinic-1', 'Urology');

    const where = argsOf(tx.selects[0], 'where')[0][0];
    expect(bindsValue(where, 'lab-1')).toBe(true);
  });
});
