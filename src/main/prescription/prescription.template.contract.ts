type ConditionalReference = {
  label: string;
  acceptedExpressions: string[];
};

type LoopRequirement = {
  label: string;
  loop: string;
  requiredInsideLoop: string[];
  acceptedAlternatives?: string[];
};

export const REQUIRED_SCALAR_PLACEHOLDERS = [
  '{{patient.name}}',
  '{{patient.age}}',
  '{{patient.gender}}',
  '{{patient.address}}',
  '{{clinic.logo}}',
  '{{clinic.name}}',
  '{{clinic.tagline}}',
  '{{clinic.address}}',
  '{{clinic.city}}',
  '{{clinic.state}}',
  '{{clinic.zipcode}}',
  '{{clinic.phone}}',
  '{{doctor.name}}',
  '{{doctor.speciality}}',
  '{{doctor.qualification}}',
  '{{doctor.email}}',
  '{{doctor.registrationNumber}}',
  '{{appointmentDate}}',
  '{{appointmentTime}}',
  '{{token}}',
  '{{followUpDate}}',
  '{{visitingNotes}}',
  '{{diagnosis}}',
  '{{testNames}}',
  '{{advice}}',
  '{{dietarySuggestion}}',
  '{{vitals.bpSys}}',
  '{{vitals.bpDia}}',
  '{{vitals.fbs}}',
  '{{vitals.ppbs}}',
  '{{vitals.rbs}}',
  '{{vitals.pulse}}',
  '{{vitals.spo2}}',
  '{{vitals.temperatureC}}',
  '{{vitals.weightKg}}',
  '{{vitals.heightCm}}',
  '{{vitals.bmi}}',
] as const;

export const REQUIRED_CONDITIONAL_REFERENCES: ConditionalReference[] = [
  {
    label: 'hasTests',
    acceptedExpressions: ['{{#if hasTests}}', '{{hasTests}}'],
  },
  {
    label: 'vitalsMoreThanOne',
    acceptedExpressions: ['{{#if vitalsMoreThanOne}}', '{{vitalsMoreThanOne}}'],
  },
  {
    label: 'token',
    acceptedExpressions: ['{{#if token}}', '{{token}}'],
  },
  {
    label: 'followUpDate',
    acceptedExpressions: ['{{#if followUpDate}}', '{{followUpDate}}'],
  },
  {
    label: 'visitingNotes',
    acceptedExpressions: ['{{#if visitingNotes}}', '{{visitingNotes}}'],
  },
  {
    label: 'surgerySuggested',
    acceptedExpressions: ['{{#if surgerySuggested}}', '{{surgerySuggested}}'],
  },
  {
    label: 'diagnosis',
    acceptedExpressions: ['{{#if diagnosis}}', '{{diagnosis}}'],
  },
  {
    label: 'advice',
    acceptedExpressions: ['{{#if advice}}', '{{advice}}'],
  },
  {
    label: 'dietarySuggestion',
    acceptedExpressions: ['{{#if dietarySuggestion}}', '{{dietarySuggestion}}'],
  },
] as const;

export const LOOP_REQUIREMENTS: LoopRequirement[] = [
  {
    label: 'doctor.availability',
    loop: '{{#each doctor.availability}}',
    requiredInsideLoop: ['{{this.day}}', '{{{this.display}}}'],
    acceptedAlternatives: ['{{#if this.isAvailable}}', '{{this.isAvailable}}'],
  },
  {
    label: 'symptoms',
    loop: '{{#each symptoms}}',
    requiredInsideLoop: ['{{this.name}}'],
  },
  {
    label: 'habits',
    loop: '{{#each habits}}',
    requiredInsideLoop: ['{{this}}'],
  },
  {
    label: 'allergies',
    loop: '{{#each allergies}}',
    requiredInsideLoop: ['{{this}}'],
  },
  {
    label: 'visitingDays',
    loop: '{{#each visitingDays}}',
    requiredInsideLoop: ['{{this}}'],
  },
  {
    label: 'surgerySuggested',
    loop: '{{#each surgerySuggested}}',
    requiredInsideLoop: ['{{this}}'],
  },
  {
    label: 'prescriptions',
    loop: '{{#each prescriptions}}',
    requiredInsideLoop: [
      '{{this.medicineName}}',
      '{{this.dosage}}',
      '{{this.frequency}}',
      '{{this.duration}}',
      '{{this.notes}}',
    ],
  },
] as const;

export const HARD_CODED_REMOTE_IMAGE_PATTERN =
  /<img\b[^>]*\bsrc=["']https?:\/\/(?!\{\{clinic\.logo\}\}|res\.cloudinary\.com\/ddzkedas8\/image\/upload\/v1772172278\/download_zafkmm\.png|infinitymedisetu\.com\/app\/assets\/images\/new-logo\.svg)[^"']+["'][^>]*>/i;

export const FORBIDDEN_TEMPLATE_PATTERNS = [
  {
    label: 'stray closing bracket after block tag',
    pattern: /\{\{\/(?:if|each|unless)\}\]|\{\{\/(?:if|each|unless)\}\}\s*]/i,
  },
  {
    label: 'invalid css line comments',
    pattern: /(^|\s)\/\/.+$/m,
  },
] as const;

export const CORE_IDENTITY_PLACEHOLDERS = [
  '{{doctor.name}}',
  '{{clinic.name}}',
  '{{doctor.email}}',
] as const;

const formatBulletList = (items: readonly string[]) =>
  items.map((item) => `- ${item}`).join('\n');

export const buildDynamicPlaceholderContract = () => {
  const sections = [
    'COMPLIANCE CONTRACT (STRICT)',
    '- Every scalar placeholder below MUST appear in the final template at least once, exactly as written.',
    '- Every loop expression below MUST appear exactly as written, and required placeholders must be present inside that same loop block.',
    '- If a value is unknown in the image, still keep the placeholder in a logical fallback section.',
    '- Do not rename placeholders. Do not flatten nested paths. Do not convert loops into static text.',
    '',
    '**Scalar placeholders (must appear at least once)**',
    formatBulletList(REQUIRED_SCALAR_PLACEHOLDERS),
    '',
    '**Conditional references (at least one accepted expression required)**',
    ...REQUIRED_CONDITIONAL_REFERENCES.map(
      (reference) =>
        `- ${reference.label}: ${reference.acceptedExpressions.join(' or ')}`
    ),
    '',
    '**Required loops (loop + required items inside loop body)**',
    ...LOOP_REQUIREMENTS.map((requirement) => {
      const items = requirement.requiredInsideLoop.join(', ');
      const alternatives = requirement.acceptedAlternatives?.length
        ? ` | also include one of: ${requirement.acceptedAlternatives.join(', ')}`
        : '';

      return `- ${requirement.loop} -> ${items}${alternatives}`;
    }),
  ];

  return sections.join('\n');
};
