/** How the screen fills an auto cell; `from` names cells of the same row, patient age / sex and Vitals come from the visit. */
export type ExamAuto =
  | { kind: 'average' | 'das28Esr' | 'ratio'; from: readonly string[] }
  | {
      kind:
        | 'whoHearingGrade'
        | 'egfrCkdEpi'
        | 'ckdStage'
        | 'das28Activity'
        | 'eddFromLmp'
        | 'cycleDay';
      from: string;
    }
  | { kind: 'gestationalAge'; from: readonly string[] }
  | { kind: 'bsaMosteller' }
  /** Positive when this row's wheal beats the table's saline control by 3 mm or more. */
  | { kind: 'skinPrick'; from: string; control: string };

/** One cell of an exam table. `auto` cells are filled by the screen from other cells, never typed. */
export interface ExamCell {
  key: string;
  label: string;
  /** `suggest`: a pick list the doctor may also type past; saved and checked as text. */
  type: 'text' | 'select' | 'suggest' | 'multi' | 'number' | 'date' | 'time';
  hint?: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  auto?: ExamAuto;
  /** A short note that prints on the same line as this single, e.g. Spleen size next to Spleen. */
  noteFor?: string;
  /** Private: never prints, and only Doctor / Admin can read it back. */
  noPrint?: boolean;
  /** A "Vaccines given today" pick: saving the visit records each dose in patient_vaccines; never copied to a later visit. */
  recordsVaccines?: boolean;
  /** Kept so old visits still save and print, but no longer shown (e.g. moved to Vitals). */
  retired?: boolean;
  /** Eye text values: `diopter` = lens power in 0.25 steps within min/max; `vision` = 6/9, N6, CF, HM, PL… */
  check?: 'diopter' | 'vision';
}

/** A specialty exam table: rows (sides) × columns, plus single fields below. Saved keys: `table.row.cell` / `table.cell`. */
export interface ExamTable {
  id: string;
  title: string;
  rows: readonly { key: string; label: string }[];
  columns: readonly ExamCell[];
  singles?: readonly ExamCell[];
  /** Rows the doctor adds one by one ("+ Add joint"); `rows` then holds the numbered slots 1…max. */
  addable?: string;
  /** Rows are not right / left pairs (e.g. meals), so no Copy button. */
  noCopy?: boolean;
  /** Row cells print as plain values, e.g. "Breakfast: Poha · 1 bowl". */
  valuesOnly?: boolean;
  /** Row keys printed only when the other rows are empty, e.g. dilated refraction on a glasses Rx. */
  fallbackRows?: readonly string[];
}

/** Numbered row slots for an addable table, so saved keys stay known in advance. */
export const addableRows = (label: string, max: number) =>
  Array.from({ length: max }, (_, i) => ({
    key: String(i + 1),
    label: `${label} ${i + 1}`,
  }));

export const MAX_NOTE_LENGTH = 200;
