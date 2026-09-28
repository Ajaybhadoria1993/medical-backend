// Unit tests for DoctorServices.getTopMedicines — GET /doctor/top-used-medicines.
// Guards the trimmed field list the prescription picker depends on.

const selectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

jest.mock('../../../utils/logger');
jest.mock('../../../configurations/s3', () => ({ deleteFromS3: jest.fn() }));
jest.mock('../../realtime', () => ({
  realtimeBus: { emit: jest.fn() },
  target: jest.fn(),
}));
jest.mock('../../../utils/notificationHelpers', () => ({
  notifyDoctorProfileUpdateRequested: jest.fn(),
}));

import { DoctorServices } from '../services/doctor.service';
import { MedicineModel } from '../../medicine/models/medicine.model';

type Call = { method: string; args: any[] };

const DOCTOR = 'doctor-1';

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
  // Nested and()/or() push bound values past 15 levels; 25 leaves headroom.
  if (depth > 25 || node == null) return false;
  if (node === needle) return true;
  if (Array.isArray(node)) {
    return node.some((item) => bindsValue(item, needle, depth + 1));
  }
  if (typeof node !== 'object') return false;
  return ['value', 'queryChunks', 'left', 'right', 'conditions'].some((key) =>
    bindsValue(node[key], needle, depth + 1)
  );
};

const medicines = [
  {
    medicineId: 'med-1',
    medicineName: 'DOLO DROPS',
    composition: 'Paracetamol (100mg/ml)',
    form: 'Drops',
    strength: null,
    manufacturer: 'Micro Labs Ltd',
    isFavorite: false,
  },
];

/** Queues the count query, then the list query; returns both for inspection. */
const mockQueries = (total: number, rows: unknown[]) => {
  const countQuery = queryReturning([{ total }]);
  const listQuery = queryReturning(rows);
  selectMock.mockReturnValueOnce(countQuery).mockReturnValueOnce(listQuery);
  return { countQuery, listQuery };
};

describe('DoctorServices.getTopMedicines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectMock.mockReset();
  });

  it('selects only the fields the prescription picker uses', async () => {
    mockQueries(1, medicines);

    await DoctorServices.getTopMedicines(DOCTOR, {});

    expect(Object.keys(selectMock.mock.calls[1][0]).sort()).toEqual(
      [
        'composition',
        'form',
        'isFavorite',
        'manufacturer',
        'medicineId',
        'medicineName',
        'strength',
      ].sort()
    );
  });

  it('no longer returns usage stats or unused medicine fields', async () => {
    mockQueries(1, medicines);

    await DoctorServices.getTopMedicines(DOCTOR, {});

    const fields = selectMock.mock.calls[1][0];
    for (const hidden of [
      'genericName',
      'category',
      'requiresPrescription',
      'usageCount',
      'lastUsed',
      'firstUsed',
    ]) {
      expect(fields).not.toHaveProperty(hidden);
    }
  });

  it('returns the rows with pagination built from the count', async () => {
    mockQueries(2, medicines);

    const result = await DoctorServices.getTopMedicines(DOCTOR, {});

    expect(result.data).toEqual(medicines);
    expect(result.pagination).toEqual({
      totalRecords: 2,
      totalPages: 1,
      currentPage: 1,
      pageSize: 10,
    });
  });

  it('counts and lists only this doctor prescriptions and favourites', async () => {
    const { countQuery, listQuery } = mockQueries(1, medicines);

    await DoctorServices.getTopMedicines(DOCTOR, {});

    for (const query of [countQuery, listQuery]) {
      expect(bindsValue(argsOf(query, 'leftJoin'), DOCTOR)).toBe(true);
      expect(bindsValue(argsOf(query, 'where'), DOCTOR)).toBe(true);
    }
  });

  it('counts and lists only active medicines', async () => {
    const { countQuery, listQuery } = mockQueries(1, medicines);

    await DoctorServices.getTopMedicines(DOCTOR, {});

    for (const query of [countQuery, listQuery]) {
      expect(bindsValue(argsOf(query, 'where'), MedicineModel.isActive)).toBe(
        true
      );
    }
  });

  it('applies page and limit as limit/offset', async () => {
    const { listQuery } = mockQueries(12, medicines);

    const result = await DoctorServices.getTopMedicines(DOCTOR, {
      page: 2,
      limit: 5,
    });

    expect(argsOf(listQuery, 'limit')).toEqual([[5]]);
    expect(argsOf(listQuery, 'offset')).toEqual([[5]]);
    expect(result.pagination).toMatchObject({ totalPages: 3, currentPage: 2 });
  });

  it('narrows the list by a lowercase search pattern', async () => {
    const { listQuery } = mockQueries(1, medicines);

    await DoctorServices.getTopMedicines(DOCTOR, { search: 'DOLO' });

    expect(bindsValue(argsOf(listQuery, 'where'), '%dolo%')).toBe(true);
  });
});
