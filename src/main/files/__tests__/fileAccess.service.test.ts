// Guards the tenancy filter on the document sign endpoint.
// A missing clinic filter here hands one clinic another's prescriptions.

const selectMock = jest.fn();
const signS3UrlMock = jest.fn();
const readS3ObjectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

jest.mock('../services/fileUrl.service', () => ({
  signS3Url: (...args: unknown[]) => signS3UrlMock(...args),
  readS3Object: (...args: unknown[]) => readS3ObjectMock(...args),
}));

import {
  readClinicDocument,
  signClinicDocument,
  signPatientDocument,
} from '../services/fileAccess.service';
import { DOCUMENT_TTL_SECONDS } from '../utils/s3Ref.utils';

const CLINIC = 'clinic-1';

/** Chainable query stub that records every where() and resolves to `rows`. */
const queryReturning = (rows: unknown[]) => {
  const whereArgs: unknown[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'limit', 'where']) {
    chain[method] = jest.fn((...args: unknown[]) => {
      if (method === 'where') whereArgs.push(args[0]);
      return method === 'limit' ? Promise.resolve(rows) : chain;
    });
  }
  return { chain, whereArgs };
};

beforeEach(() => {
  selectMock.mockReset();
  signS3UrlMock.mockReset();
  readS3ObjectMock.mockReset();
  signS3UrlMock.mockResolvedValue('https://signed.example/x?sig=1');
});

describe('signClinicDocument', () => {
  it.each(['labReport', 'prescription', 'consent'] as const)(
    'signs a %s the clinic owns',
    async (type) => {
      const { chain } = queryReturning([{ location: 'production/x.pdf' }]);
      selectMock.mockReturnValue(chain);

      const result = await signClinicDocument({ type, id: 'rec-1' }, CLINIC);

      expect(result).toEqual({
        url: 'https://signed.example/x?sig=1',
        expiresIn: DOCUMENT_TTL_SECONDS,
      });
      expect(signS3UrlMock).toHaveBeenCalledWith('production/x.pdf', {
        expiresIn: DOCUMENT_TTL_SECONDS,
      });
    }
  );

  it.each(['labReport', 'prescription', 'consent'] as const)(
    'filters %s by clinic, so another clinic gets no row',
    async (type) => {
      const { chain, whereArgs } = queryReturning([]);
      selectMock.mockReturnValue(chain);

      await expect(
        signClinicDocument({ type, id: 'rec-1' }, CLINIC)
      ).rejects.toMatchObject({ status: 404 });

      // Every lookup must constrain on something, never select by id alone.
      expect(whereArgs).toHaveLength(1);
      expect(whereArgs[0]).toBeDefined();
      expect(signS3UrlMock).not.toHaveBeenCalled();
    }
  );

  it('404s when the record exists but holds no document', async () => {
    const { chain } = queryReturning([{ location: null }]);
    selectMock.mockReturnValue(chain);

    await expect(
      signClinicDocument({ type: 'labReport', id: 'rec-1' }, CLINIC)
    ).rejects.toMatchObject({ status: 404 });
    expect(signS3UrlMock).not.toHaveBeenCalled();
  });

  it('404s rather than returning an unsignable stored value', async () => {
    const { chain } = queryReturning([{ location: 'production/x.pdf' }]);
    selectMock.mockReturnValue(chain);
    signS3UrlMock.mockResolvedValue(null);

    await expect(
      signClinicDocument({ type: 'labReport', id: 'rec-1' }, CLINIC)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('readClinicDocument', () => {
  const query = {
    type: 'labReport',
    id: 'rec-1',
    downloadAs: 'Lab-Report_CT-KUB',
  } as const;

  it("names the file after the caller, keeping the stored file's extension", async () => {
    const { chain } = queryReturning([{ location: 'production/scan.jpg' }]);
    selectMock.mockReturnValue(chain);
    readS3ObjectMock.mockResolvedValue({
      bytes: Buffer.from('x'),
      contentType: 'image/jpeg',
      key: 'production/scan.jpg',
    });

    const file = await readClinicDocument(query, CLINIC);

    expect(readS3ObjectMock).toHaveBeenCalledWith('production/scan.jpg');
    expect(file).toMatchObject({
      contentType: 'image/jpeg',
      fileName: 'Lab-Report_CT-KUB.jpg',
    });
  });

  it('404s without reading storage when another clinic owns the record', async () => {
    const { chain } = queryReturning([]);
    selectMock.mockReturnValue(chain);

    await expect(readClinicDocument(query, CLINIC)).rejects.toMatchObject({
      status: 404,
    });
    expect(readS3ObjectMock).not.toHaveBeenCalled();
  });

  it('404s when the stored object is gone', async () => {
    const { chain } = queryReturning([{ location: 'production/x.pdf' }]);
    selectMock.mockReturnValue(chain);
    readS3ObjectMock.mockResolvedValue(null);

    await expect(readClinicDocument(query, CLINIC)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('signPatientDocument', () => {
  /** The family-link query resolves at where(); the document lookup follows it. */
  const withFamily = (linkedIds: string[], lookupRows: unknown[]) => {
    const family: { from: jest.Mock; where: jest.Mock } = {
      from: jest.fn(() => family),
      where: jest.fn(() => Promise.resolve(linkedIds.map((id) => ({ id })))),
    };
    const lookup = queryReturning(lookupRows);
    selectMock.mockReturnValueOnce(family).mockReturnValueOnce(lookup.chain);
    return lookup;
  };

  it.each([
    'prescription',
    'appointmentPrescription',
    'manualPrescription',
    'consent',
    'labReport',
  ] as const)('signs a %s the patient or their family owns', async (type) => {
    // appointmentPrescription picks between two columns; the rest read one.
    const row =
      type === 'appointmentPrescription'
        ? { reportCard: null, manual: 'production/x.pdf' }
        : { location: 'production/x.pdf' };
    withFamily(['child-1'], [row]);

    const result = await signPatientDocument(
      { type, id: 'rec-1' },
      'patient-1'
    );

    expect(result).toEqual({
      url: 'https://signed.example/x?sig=1',
      expiresIn: DOCUMENT_TTL_SECONDS,
    });
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  // Without the patient filter this hands one patient another's documents.
  it('404s when the record belongs to someone outside the family', async () => {
    const { whereArgs } = withFamily([], []);

    await expect(
      signPatientDocument({ type: 'labReport', id: 'rec-1' }, 'patient-1')
    ).rejects.toMatchObject({ status: 404 });

    expect(whereArgs).toHaveLength(1);
    expect(signS3UrlMock).not.toHaveBeenCalled();
  });

  it('404s when the record has no file yet', async () => {
    withFamily([], [{ location: null }]);

    await expect(
      signPatientDocument({ type: 'prescription', id: 'rc-1' }, 'patient-1')
    ).rejects.toMatchObject({ status: 404 });
  });
});
