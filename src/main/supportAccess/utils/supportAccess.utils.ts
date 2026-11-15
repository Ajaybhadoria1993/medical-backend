export const SESSION_MINUTES = 30;

/** Clinic roles a Super Admin may view as; never another Super Admin or a patient. */
export const VIEWABLE_ROLES = [
  'Admin',
  'Doctor',
  'Receptionist',
  'Nurse',
  'Pharmacist',
  'Lab_Assistant',
];

/** The one write a "View as" token may make: ending its own session. */
export const SUPPORT_EXIT_PATH = '/api/v1/support-access/session/end';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isReadMethod = (method: string) => READ_METHODS.has(method);

/** Clinical reads a support view never gets, even masked: prescriptions, lab results, files,
 *  treatment plans, photos, consents. Settings under the same prefixes stay readable. */
const CLINICAL_READS = [
  /^\/api\/v1\/prescription(\/|$)/,
  /^\/api\/v1\/reports(?!\/(prescription-template|preview-prescription-template|translations|template-info))(\/|$)/,
  /^\/api\/v1\/lab\/(lab-report|lab-test-result-parameters)(\/|$)/,
  /^\/api\/v1\/files(\/|$)/,
  /^\/api\/v1\/treatment-plan(?!\/(settings|specialty-configs|templates))(\/|$)/,
  /\/(get-patient-gallery|get-doctor-gallery[^/]*|consent|medical-certificate)(\/|$)/,
  // Free-text messages name patients ("Ravi booked…"), which field-name masking can't catch.
  /^\/api\/v1\/notifications\/(inbox|events)(\/|$)/,
  // Typing a number or name would confirm the person is a patient here, even with masked results.
  /^\/api\/v1\/patient\/search(\/|$)/,
  // The staff member's own 2-step login is theirs alone.
  /^\/api\/v1\/mfa(\/|$)/,
];

export const isClinicalRead = (url: string) => {
  const [path, query = ''] = url.split('?');
  const searchesPatients =
    /^\/api\/v1\/patient\/?$/.test(path) && /(^|&)q=[^&]+/.test(query);
  return searchesPatients || CLINICAL_READS.some((re) => re.test(path));
};

const FILE_SEGMENT =
  /^(pdf|download|print|export|excel|csv|xlsx)$|^(download|export)-|[-.]pdf$/i;

// ponytail: URL-shape match, add a route flag if a file route is ever named otherwise.
/** Routes that hand out a file (`/card/:id/pdf`, `/export-all-stock`, `?format=csv`); a file can't stay masked.
 *  Whole segments only, so settings like `/doctor-prescription-print-type` still load. */
export const isFileRoute = (url: string) => {
  const [path, query = ''] = url.split('?');
  return (
    path.split('/').some((seg) => FILE_SEGMENT.test(seg)) ||
    /(^|&)format=(pdf|csv|xlsx|excel)(&|$)/i.test(query)
  );
};
