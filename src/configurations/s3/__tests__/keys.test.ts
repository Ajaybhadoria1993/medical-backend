// Guards the upload key shape: the clinic prefix is the ownership check,
// and the original filename must never reach the key.

const warnMock = jest.fn();

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: { warn: (...args: unknown[]) => warnMock(...args) },
}));

import {
  buildObjectKey,
  fileExtension,
  UNSCOPED_ROOT,
  type KeyRequest,
} from '../keys';

const CLINIC = '8f3a91c2-4d5e-4a1b-9c33-77e2b0a4f1d9';
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const req = (over: Partial<KeyRequest> = {}) =>
  ({
    method: 'POST',
    baseUrl: '/api/v1/lab',
    path: '/results/x/report',
    ...over,
  }) as KeyRequest;

beforeEach(() => warnMock.mockReset());

describe('buildObjectKey', () => {
  it('puts the clinic in the path when the route provides one', () => {
    const key = buildObjectKey(
      req({ clinicId: CLINIC }),
      'prescriptions',
      'report.pdf'
    );
    expect(key).toMatch(
      new RegExp(`^c/${CLINIC}/prescriptions/\\d{4}/\\d{2}/${UUID_RE}\\.pdf$`)
    );
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('falls back to the lab when there is no clinic', () => {
    const key = buildObjectKey(
      req({ labId: 'lab-7' }),
      'patient_tests',
      'a.pdf'
    );
    expect(key.startsWith('lab/lab-7/patient_tests/')).toBe(true);
  });

  // The warning is how we find routes still missing requireClinic.
  it('marks an untenanted upload and warns', () => {
    const key = buildObjectKey(req(), 'patient_tests', 'a.pdf');
    expect(key.startsWith(`${UNSCOPED_ROOT}/patient_tests/`)).toBe(true);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('never logs the filename, which carries the patient name', () => {
    buildObjectKey(req(), 'patient_tests', 'Ramesh-Sharma-report.pdf');
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('Ramesh');
  });

  it('drops the original filename from the key entirely', () => {
    const key = buildObjectKey(
      req({ clinicId: CLINIC }),
      'patient_tests',
      'Ramesh-Sharma-report.pdf'
    );
    expect(key).not.toContain('Ramesh');
    expect(key).not.toContain('Sharma');
  });

  it('lowercases the extension and keeps it', () => {
    const key = buildObjectKey(
      req({ clinicId: CLINIC }),
      'clinic_logos',
      'LOGO.PNG'
    );
    expect(key.endsWith('.png')).toBe(true);
  });

  it('gives two uploads of one filename different keys', () => {
    const args = [req({ clinicId: CLINIC }), 'patient_tests', 'a.pdf'] as const;
    expect(buildObjectKey(...args)).not.toBe(buildObjectKey(...args));
  });
});

describe('fileExtension', () => {
  it.each([
    ['a.PDF', 'pdf'],
    ['a.tar.gz', 'gz'],
    ['noext', ''],
  ])('reads %s as %s', (name, expected) => {
    expect(fileExtension(name)).toBe(expected);
  });
});
