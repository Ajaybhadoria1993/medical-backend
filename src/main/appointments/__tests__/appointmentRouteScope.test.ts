import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// Every staff route taking :appointmentId must run requireAppointmentScope, or be listed here with why.
const MAIN = join(__dirname, '..', '..');

const OWN_CHECK: Record<string, string> = {
  'appointments/routes/v1/appointments.route.ts delete /delete-patient-gallery-of-appointment/:appointmentId':
    'service refuses anyone but the appointment doctor',
  'appointments/routes/v1/appointments.route.ts post /:appointmentId/shared-images':
    'galleryShare service refuses anyone but the appointment doctor',
  'appointments/routes/v1/appointments.route.ts get /:appointmentId/shared-images':
    'galleryShare service refuses anyone but the appointment doctor',
  'appointments/routes/v1/appointments.route.ts delete /:appointmentId/shared-images/:shareId':
    'galleryShare service refuses anyone but the appointment doctor',
  'appointments/routes/v1/appointments.route.ts post /:appointmentId/send-manual-prescription-notification':
    'service matches the appointment doctor in its WHERE',
  'appointments/routes/v1/appointments.route.ts get /:appointmentId/details':
    'service checks clinic and staff scope',
  'appointments/routes/v1/appointments.route.ts get /:appointmentId':
    'service checks clinic and staff scope',
  'doctor/routes/v1/doctor.route.ts get /reviews/appointment/:appointmentId':
    'service matches the review doctor in its WHERE',
  // ponytail: KNOWN GAP — no clinic or scope check; left for the lab-flow work, remove once fixed.
  'test/routes/v1/appointmentTest.route.ts get /appointment/:appointmentId':
    'lab module, not yet scoped',
};

const routeFiles = (readdirSync(MAIN, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => /\/routes\/.+\.ts$/.test(f));

const unscoped = routeFiles.flatMap((file) => {
  const src = readFileSync(join(MAIN, file), 'utf8');
  const blocks = src.matchAll(
    /\w+Router\.(get|post|put|patch|delete)\(\s*'([^']+)'([\s\S]*?)\n\);/g
  );
  return [...blocks]
    .filter(
      ([, , path, body]) =>
        path.includes(':appointmentId') &&
        !/requireAppointmentScope|requirePatient/.test(body)
    )
    .map(
      ([, method, path]) =>
        `${relative(MAIN, join(MAIN, file)).replace(/\\/g, '/')} ${method} ${path}`
    );
});

describe('appointment routes — staff scope coverage', () => {
  it('finds the route files it is meant to scan', () => {
    expect(routeFiles).toContain(
      'appointments/routes/v1/appointments.route.ts'
    );
  });

  it('has no :appointmentId route missing requireAppointmentScope', () => {
    expect(unscoped.filter((r) => !(r in OWN_CHECK))).toEqual([]);
  });

  it('keeps the exception list free of routes that no longer need it', () => {
    expect(Object.keys(OWN_CHECK).filter((r) => !unscoped.includes(r))).toEqual(
      []
    );
  });
});
