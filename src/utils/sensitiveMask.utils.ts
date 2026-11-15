// Field-name masking for responses shown to MediArogya staff (Super Admin pages, "View as" sessions).

export const HIDDEN_TEXT = 'Hidden for privacy';
const STARS = '****';

export interface MaskOptions {
  /** True for a stored file (S3 key or URL); such values become null so the file can't be opened. */
  isFile?: (value: string) => boolean;
}

/** Lowercase, letters and digits only, so `patient_name`, `patientName` and `PatientName` match alike. */
const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const has = (key: string, parts: string[]) =>
  parts.some((p) => key.includes(p));

const BIRTH = ['dob', 'dateofbirth', 'birthdate'];

/** Ids, counts, dates, flags and statuses carry no personal detail and keep screens working. */
const isStructural = (key: string) =>
  key === 'id' ||
  (/(id|ids|count|total|at|date|time|status|type|kind)$/.test(key) &&
    !BIRTH.includes(key)) ||
  /^(is|has|can)/.test(key);

const CLINICAL = [
  'diagnos',
  'complaint',
  'symptom',
  'allerg',
  'vital',
  'finding',
  'prescri',
  // No 'medicin': pharmacy stock and sales reports are catalogue data; a prescription's medicines are hidden by 'prescri'.
  'medicat',
  'dosage',
  'instruction',
  'advice',
  'observation',
  'examination',
  'treatment',
  'procedure',
  'clinical',
  'remark',
  'investigation',
  'chief',
  'labresult',
  'testresult',
  'resultvalue',
  'medicalhistory',
  'familyhistory',
  'pasthistory',
  'surgicalhistory',
  'note',
  'comment',
  'transcript',
  // Free text that staff type and that often names the patient ("Ravi called to cancel").
  'reason',
  'activity',
];
const isClinical = (key: string) => has(key, CLINICAL) || key.startsWith('icd');

const PHONE = ['phone', 'mobile', 'whatsapp', 'contactno', 'contactnumber'];
const ADDRESS = [
  'address',
  'street',
  'pincode',
  'zipcode',
  'postalcode',
  'landmark',
  'locality',
];
const ID_NUMBER = [
  'aadhaar',
  'aadhar',
  'abha',
  'gst',
  'passport',
  'ifsc',
  'accountnumber',
  'accountno',
  'upi',
  'bankaccount',
  'cardnumber',
  'licen',
  'registrationnumber',
  'regno',
];
const SECRET = ['password', 'secret', 'accesstoken', 'refreshtoken', 'otp'];
const PERSON_NAME = ['name', 'firstname', 'middlename', 'lastname', 'fullname'];
const RELATIVE_NAME = [
  'patientname',
  'guardianname',
  'fathername',
  'mothername',
  'spousename',
  'kinname',
  'emergencycontactname',
  'linkedto',
  'holdername',
];

/** `petient` is a real key: the patients list API ships under `result.petients`. */
const isPatientKey = (key: string) =>
  (key.includes('patient') || key.includes('petient')) && !isStructural(key);

const isStaffKey = (key: string) =>
  ['doctor', 'staff', 'receptionist', 'nurse', 'createdby', 'updatedby'].some(
    (p) => key.includes(p)
  );

/** 10–13 digits, optional `+`, spaces or dashes: a phone number whatever the field is called. */
const looksLikePhone = (value: string) =>
  /^\+?[\d\s-]{10,16}$/.test(value) && value.replace(/\D/g, '').length >= 10;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return STARS;
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}

export function maskEmail(value: string): string {
  const [user, domain] = value.split('@');
  if (!domain) return STARS;
  return `${user.slice(0, 2)}***@${domain}`;
}

/** Last four characters only, e.g. GSTIN or bank account `XXXX1234`. */
export function maskIdNumber(value: string): string {
  return value.length <= 4 ? STARS : `XXXX${value.slice(-4)}`;
}

export function maskIp(value: string): string {
  const parts = value.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : STARS;
}

/** `Ravi Sharma` → `R*** S***`. */
export function maskName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]}***`)
    .join(' ');
}

function maskString(
  key: string,
  value: string,
  inPatient: boolean
): string | null {
  if (has(key, SECRET)) return null;
  if (has(key, PHONE) || looksLikePhone(value)) return maskPhone(value);
  if (key.includes('email')) return maskEmail(value);
  if (has(key, ADDRESS)) return STARS;
  if (
    has(key, ID_NUMBER) ||
    ['pan', 'panno', 'pannumber', 'pancard'].includes(key)
  ) {
    return maskIdNumber(value);
  }
  if (['ip', 'ipaddress', 'lastip', 'loginip'].includes(key))
    return maskIp(value);
  if (BIRTH.includes(key)) return STARS;
  if (has(key, RELATIVE_NAME) || (inPatient && PERSON_NAME.includes(key))) {
    return maskName(value);
  }
  return value;
}

function walk(
  value: unknown,
  key: string,
  ctx: { clinical: boolean; patient: boolean },
  opts: MaskOptions
): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, key, ctx, opts));
  if (value instanceof Date || value === null || value === undefined)
    return value;

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const nk = norm(k);
      out[k] = walk(
        v,
        nk,
        {
          clinical: ctx.clinical || (!isStructural(nk) && isClinical(nk)),
          // A doctor or staff object inside a patient row is staff, whose names stay visible.
          patient: isStaffKey(nk) ? false : ctx.patient || isPatientKey(nk),
        },
        opts
      );
    }
    return out;
  }

  if (isStructural(key)) return value;
  if (typeof value === 'string') {
    if (opts.isFile?.(value)) return null;
    // Already masked values pass through, so a response masked twice reads the same.
    if (value === HIDDEN_TEXT || value.includes('***')) return value;
    if (ctx.clinical || isClinical(key)) return value ? HIDDEN_TEXT : value;
    return maskString(key, value, ctx.patient);
  }
  if (typeof value === 'number') {
    if (ctx.clinical || isClinical(key)) return null;
    // By key only: a 13-digit number is as likely an epoch timestamp as a phone.
    if (has(key, PHONE)) return maskPhone(String(value));
  }
  return value;
}

/** Copies `value` with contact details, ID numbers and IPs masked and clinical text hidden.
 *  Shape is kept (arrays stay arrays) so screens render; ids, dates and statuses are untouched. */
export function maskSensitive(value: unknown, opts: MaskOptions = {}): unknown {
  return walk(value, '', { clinical: false, patient: false }, opts);
}
