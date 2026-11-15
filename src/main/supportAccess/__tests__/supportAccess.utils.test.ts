import { isClinicalRead, isFileRoute } from '../utils/supportAccess.utils';

describe('isClinicalRead', () => {
  it.each([
    '/api/v1/reports/card/all/p1',
    '/api/v1/reports/3f0c2a10-0000-4000-8000-000000000000',
    '/api/v1/prescription/scan/status',
    '/api/v1/lab/lab-report/test/t1',
    '/api/v1/files/sign?key=x',
    '/api/v1/treatment-plan/plan-1',
    '/api/v1/appointments/get-patient-gallery?appointmentId=a1',
    '/api/v1/notifications/inbox?page=1',
    '/api/v1/patient/search?q=98765',
    '/api/v1/patient?page=1&q=ravi',
  ])('blocks %s', (url) => expect(isClinicalRead(url)).toBe(true));

  it.each([
    '/api/v1/reports/prescription-template',
    '/api/v1/reports/translations/settings',
    '/api/v1/treatment-plan/settings',
    '/api/v1/appointments',
    '/api/v1/patient',
    '/api/v1/patient?page=1&q=',
    '/api/v1/notifications/unread-count',
  ])('allows %s', (url) => expect(isClinicalRead(url)).toBe(false));
});

describe('isFileRoute', () => {
  it('matches whole segments only', () => {
    expect(isFileRoute('/api/v1/reports/card/r1/pdf')).toBe(true);
    expect(
      isFileRoute('/api/v1/pharmacies/medicine/export-all-medicines')
    ).toBe(true);
    expect(isFileRoute('/api/v1/finance/statement?format=csv')).toBe(true);
    expect(isFileRoute('/api/v1/doctor/doctor-prescription-print-type')).toBe(
      false
    );
    expect(isFileRoute('/api/v1/lab/barcodes/b1/print-data')).toBe(false);
  });
});
