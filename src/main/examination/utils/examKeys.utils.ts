import { DOCTOR_SPECIALTY_CONFIG } from '../../../utils/specialties';
import {
  MAX_NOTE_LENGTH,
  type ExamCell,
  type ExamTable,
} from '../../../utils/specialties/examTables';

export interface ExamKeyInfo {
  table: ExamTable;
  rowLabel: string | null;
  cell: ExamCell;
  order: number;
}

/** Every exam-table key any specialty can save, e.g. `ear.right.canal` or `nt.septum`. */
export const EXAM_KEYS = new Map<string, ExamKeyInfo>();
let order = 0;
// A table shared by two specialties (GP Chronic Care) is listed once.
const seen = new Set<ExamTable>();
for (const config of Object.values(DOCTOR_SPECIALTY_CONFIG)) {
  if (!('exam_tables' in config)) continue;
  for (const table of config.exam_tables as readonly ExamTable[]) {
    if (seen.has(table)) continue;
    seen.add(table);
    for (const row of table.rows) {
      for (const cell of table.columns) {
        EXAM_KEYS.set(`${table.id}.${row.key}.${cell.key}`, {
          table,
          rowLabel: row.label,
          cell,
          order: order++,
        });
      }
    }
    for (const cell of table.singles ?? []) {
      EXAM_KEYS.set(`${table.id}.${cell.key}`, {
        table,
        rowLabel: null,
        cell,
        order: order++,
      });
    }
  }
}

// ENT ear-drum diagram: `EarDrum-Right-AS` = "Perforation · Central · 25–50%" (ent-specialist.md).
export const EAR_DRUM = /^EarDrum-(Right|Left)-(Attic|AS|PS|AI|PI)$/;
export const EAR_DRUM_PARTS: Record<string, string> = {
  Attic: 'Attic',
  AS: 'Antero-superior',
  PS: 'Postero-superior',
  AI: 'Antero-inferior',
  PI: 'Postero-inferior',
};
const EAR_DRUM_FINDINGS = [
  'Perforation',
  'Retraction',
  'Tympanosclerosis',
  'Cholesteatoma',
  'Fluid',
];
const PERFORATION_TYPES = ['', 'Central', 'Marginal', 'Attic'];
// Share of the whole drum; the FE list in ent/entRules.ts must match.
const PERFORATION_SIZES = [
  '',
  'Small (< 25%)',
  'Moderate (25–50%)',
  'Subtotal (50–90%)',
  'Total',
];

// Only the diagram's own picks: a finding, plus type and size for a perforation.
const earDrumProblem = (value: string) => {
  const [finding, type = '', size = '', ...rest] = value.split(' · ');
  const isPerforation = finding === 'Perforation';
  const ok =
    EAR_DRUM_FINDINGS.includes(finding) &&
    !rest.length &&
    (isPerforation
      ? PERFORATION_TYPES.includes(type) && PERFORATION_SIZES.includes(size)
      : !type && !size);
  return ok ? null : `Ear drum: ${value} is not a finding of the diagram`;
};

// 6/9, 3/60, N6 (p = partial), CF with an optional distance, HM, PL, NPL, PR, NIPH; the FE has the same rule.
const VISION =
  /^(?:[1-6]\/\d{1,2}(?:\.\d)?p?|N\d{1,2}(?:\.\d)?p?|CF(?: ?\d(?:\.\d)? ?m)?|HM|PL|NPL|PR|NIPH)$/i;

// Eye values typed as text: lens power in 0.25 steps, or a standard vision notation.
const eyeValueProblem = (cell: ExamCell, value: string) => {
  const text = value.trim();
  if (cell.check === 'vision')
    return VISION.test(text)
      ? null
      : `${cell.label}: use 6/9, N6, CF, HM, PL or NPL`;
  if (/^plano$/i.test(text)) return null;
  const n = Number(text.replace('−', '-'));
  if (!/^[+−-]?\d{1,2}(\.\d{1,2})?$/.test(text) || !Number.isInteger(n * 4))
    return `${cell.label}: use 0.25 steps, e.g. −1.25`;
  if ((cell.min != null && n < cell.min) || (cell.max != null && n > cell.max))
    return `${cell.label}: between ${cell.min} and ${cell.max}`;
  return null;
};

/** Why a saved chart / exam note is rejected, or null when it is fine. */
export function noteProblem(key: string, value: string): string | null {
  if (value.length > MAX_NOTE_LENGTH) {
    return `${key}: keep it under ${MAX_NOTE_LENGTH} characters`;
  }
  if (key.startsWith('private.')) return null;
  if (EAR_DRUM.test(key) && value.trim()) return earDrumProblem(value);
  const info = EXAM_KEYS.get(key);
  // Dotted keys belong to exam tables and must exist; older plain keys keep saving as they always did.
  if (!info) {
    return key.includes('.') ? `${key}: not a field of any exam table` : null;
  }
  const { cell } = info;
  if (cell.type === 'number' && value.trim() && !cell.auto) {
    const n = Number(value);
    if (!Number.isFinite(n)) return `${cell.label}: enter a number`;
    if (cell.min != null && n < cell.min)
      return `${cell.label}: enter ${cell.min} or more`;
    if (cell.max != null && n > cell.max)
      return `${cell.label}: enter ${cell.max} or less`;
  }
  if (cell.check && value.trim()) {
    const problem = eyeValueProblem(cell, value);
    if (problem) return problem;
  }
  if (cell.type === 'date' && value.trim() && !isRealDate(value)) {
    return `${cell.label}: enter a real date`;
  }
  if (
    cell.type === 'time' &&
    value.trim() &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    return `${cell.label}: enter a time as HH:MM`;
  }
  if (cell.type === 'multi' && value.trim()) {
    const bad = value.split(', ').find((pick) => !cell.options?.includes(pick));
    if (bad) return `${cell.label}: ${bad} is not an option`;
  }
  return null;
}

// YYYY-MM-DD that round-trips, so 2026-02-30 is rejected.
const isRealDate = (value: string) => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(ms) &&
    new Date(ms).toISOString().startsWith(value)
  );
};
